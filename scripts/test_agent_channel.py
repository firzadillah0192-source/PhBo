import concurrent.futures
from pathlib import Path
import tempfile
import unittest

from scripts.agent_channel import Mailbox


class MailboxTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/srv/photobooth/tmp', prefix='agent-channel-test-')
        self.path = Path(self.temp.name) / 'messages.sqlite3'
        self.box = Mailbox(self.path)

    def tearDown(self):
        self.box.close()
        self.temp.cleanup()

    def test_send_reply_ack_preserves_history(self):
        sent = self.box.send('codex', 'claude', 'Deploy coordination', 'Working on timer.\nPlease reply.')
        self.assertEqual(self.box.inbox('claude')[0]['body'], sent['body'])
        self.assertEqual(self.box.inbox('codex'), [])
        reply = self.box.send('claude', 'codex', 'Re: Deploy coordination', 'I will wait.', sent['id'])
        self.assertEqual(self.box.inbox('codex')[0]['reply_to'], sent['id'])
        self.box.ack('claude', sent['id'])
        first_ack = self.box.read('claude', sent['id'])['acknowledged_at']
        self.assertEqual(self.box.ack('claude', sent['id'])['acknowledged_at'], first_ack)
        self.assertEqual(self.box.inbox('claude'), [])
        self.assertEqual(len(self.box.inbox('claude', include_acked=True)), 1)
        self.assertEqual(self.box.status()['codex']['pending'], 1)
        self.assertEqual(self.box.read('codex', reply['id'])['body'], 'I will wait.')

    def test_sender_cannot_ack_or_reply_to_own_message(self):
        sent = self.box.send('codex', 'claude', 'Question', 'Ready?')
        with self.assertRaises(ValueError):
            self.box.ack('codex', sent['id'])
        with self.assertRaises(ValueError):
            self.box.send('codex', 'claude', 'Reply', 'Incorrect direction', sent['id'])
        with self.assertRaises(ValueError):
            self.box.send('codex', 'claude', 'Reply', 'Unknown message', 'missing')

    def test_parallel_connections_do_not_lose_messages(self):
        def send(index):
            box = Mailbox(self.path)
            try:
                return box.send('codex', 'claude', f'Message {index}', 'Concurrent write')['id']
            finally:
                box.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(send, range(12)))
        self.assertEqual(len(set(ids)), 12)
        self.assertEqual(self.box.status()['claude']['pending'], 12)
        self.assertEqual(len(self.box.inbox('claude')), 12)

    def test_wait_and_input_validation(self):
        self.assertEqual(self.box.wait('claude', 0), [])
        sent = self.box.send('codex', 'claude', 'Hello', 'Message')
        self.assertEqual(self.box.wait('claude', 0)[0]['id'], sent['id'])
        for sender, recipient, subject, body in [('codex', 'codex', 'Hi', 'Hi'), ('codex', 'claude', '', 'Hi'), ('codex', 'claude', 'Hi', ''), ('codex', 'claude', 'Hi', 'x' * 16001)]:
            with self.assertRaises(ValueError):
                self.box.send(sender, recipient, subject, body)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
