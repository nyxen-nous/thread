import unittest
import time
from unittest.mock import patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from backend.app import create_app, RateLimit, ROOM_SECONDS

ORIGIN = {'origin': 'http://127.0.0.1:8787'}

class SignalingTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = TestClient(self.app)
    def ws(self, headers=ORIGIN):
        return self.client.websocket_connect('/api/ws', headers=headers)
    def test_health_and_privacy_headers(self):
        r = self.client.get('/api/health')
        self.assertEqual(r.json()['protocol'], 1)
        self.assertEqual(r.headers['referrer-policy'], 'no-referrer')
        self.assertEqual(r.headers['cache-control'], 'no-store')
    def test_config_is_direct_only(self):
        self.assertTrue(self.client.get('/api/config').json()['directOnly'])
    def test_rejects_wrong_origin(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.ws({'origin': 'https://evil.example'}): pass
    def test_rejects_missing_origin(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.ws({}): pass
    def test_create_and_cleanup(self):
        with self.ws() as host:
            host.send_json({'type': 'create'})
            msg = host.receive_json()
            self.assertEqual(msg['type'], 'created')
            self.assertEqual(len(msg['room']), 24)
            room = msg['room']
        self.assertNotIn(room, self.app.state.registry.rooms)
        self.assertEqual(self.app.state.registry.connections, 0)
    def test_join_forward_and_sender_close(self):
        with self.ws() as host:
            host.send_json({'type': 'create'}); room = host.receive_json()['room']
            with self.ws() as guest:
                guest.send_json({'type': 'join', 'room': room})
                session = guest.receive_json()['session']
                self.assertEqual(host.receive_json()['type'], 'guest_joined')
                env = {'iv': 'a'*16, 'data': 'b'*32}
                guest.send_json({'type': 'signal', 'session': session, 'envelope': env})
                self.assertEqual(host.receive_json()['envelope'], env)
                host.send_json({'type': 'approve', 'session': session})
                host.send_json({'type': 'signal', 'session': session, 'envelope': env})
                self.assertEqual(guest.receive_json()['envelope'], env)
                host.send_json({'type': 'close'})
                self.assertEqual(guest.receive_json()['type'], 'ended')
    def test_one_recipient_at_a_time(self):
        with self.ws() as host:
            host.send_json({'type': 'create'}); room = host.receive_json()['room']
            with self.ws() as guest:
                guest.send_json({'type': 'join', 'room': room}); guest.receive_json(); host.receive_json()
                with self.ws() as other:
                    other.send_json({'type': 'join', 'room': room})
                    self.assertIn('already connected', other.receive_json()['message'])
    def test_reject_then_allow_another_recipient(self):
        with self.ws() as host:
            host.send_json({'type': 'create'}); room = host.receive_json()['room']
            with self.ws() as guest:
                guest.send_json({'type': 'join', 'room': room}); sid = guest.receive_json()['session']; host.receive_json()
                host.send_json({'type': 'reject', 'session': sid})
                self.assertIn('declined', guest.receive_json()['message']); self.assertEqual(host.receive_json()['type'], 'guest_left')
            with self.ws() as other:
                other.send_json({'type': 'join', 'room': room})
                self.assertEqual(other.receive_json()['type'], 'joined')
    def test_invalid_or_expired_room(self):
        with self.ws() as guest:
            guest.send_json({'type': 'join', 'room': 'missing'})
            self.assertIn('expired', guest.receive_json()['message'])
        with self.ws() as host:
            host.send_json({'type': 'create'}); room = host.receive_json()['room']
            self.app.state.registry.rooms[room].created = time.monotonic()-ROOM_SECONDS-1
            with self.ws() as guest:
                guest.send_json({'type': 'join', 'room': room})
                self.assertIn('expired', guest.receive_json()['message'])
    def test_guest_cannot_close_room(self):
        with self.ws() as host:
            host.send_json({'type': 'create'}); room = host.receive_json()['room']
            with self.ws() as guest:
                guest.send_json({'type': 'join', 'room': room}); guest.receive_json(); host.receive_json()
                guest.send_json({'type': 'close'})
                with self.assertRaises(WebSocketDisconnect): guest.receive_json()
                self.assertIn(room, self.app.state.registry.rooms)
    def test_binary_and_oversized_messages_rejected(self):
        for payload in [b'file content', 'x'*33000]:
            with self.ws() as guest:
                if isinstance(payload, bytes): guest.send_bytes(payload)
                else: guest.send_text(payload)
                with self.assertRaises(WebSocketDisconnect): guest.receive_json()
    def test_invalid_json_rejected(self):
        with self.ws() as guest:
            guest.send_text('not JSON')
            with self.assertRaises(WebSocketDisconnect): guest.receive_json()
    def test_cross_room_signals_rejected(self):
        with self.ws() as host:
            host.send_json({'type': 'create'}); room=host.receive_json()['room']
            with self.ws() as guest:
                guest.send_json({'type':'join','room':room}); guest.receive_json(); host.receive_json()
                guest.send_json({'type':'signal','session':'wrong','envelope':{'iv':'a'*16,'data':'b'*32}})
                with self.assertRaises(WebSocketDisconnect): guest.receive_json()
    def test_capacity(self):
        with patch('backend.app.MAX_ROOMS',0):
            with self.ws() as host:
                host.send_json({'type':'create'})
                self.assertEqual(host.receive_json()['type'],'error')
    def test_rate_limits_and_bounded_buckets(self):
        rate=RateLimit(limit=2,seconds=600,capacity=2)
        self.assertTrue(rate.allow('one')); self.assertTrue(rate.allow('one'))
        self.assertFalse(rate.allow('one')); self.assertTrue(rate.allow('two'))
        self.assertFalse(rate.allow('three')); self.assertFalse(rate.allow('one'))
        self.assertEqual(len(rate.hits),2)
    def test_ping_does_not_create_a_room(self):
        with self.ws() as ws:
            ws.send_json({'type':'ping'})
            self.assertEqual(ws.receive_json(),{'type':'pong'})
            self.assertFalse(self.app.state.registry.rooms)

if __name__ == '__main__': unittest.main()
