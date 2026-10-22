"""Local, cooperative mailbox for Codex and Claude Code; no network or daemon."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone

STORE = Path('/srv/photobooth/tmp/agent-channel/messages.sqlite3')
AGENTS = ('codex', 'claude')


class Mailbox:
    def __init__(self, path=STORE):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Create privately before SQLite opens it, including on concurrent startup.
        fd = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA busy_timeout=10000')
        self.db.execute('''CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL,
            subject TEXT NOT NULL, body TEXT NOT NULL, sent_at TEXT NOT NULL,
            reply_to TEXT, acknowledged_at TEXT
        )''')
        self.db.commit()

    def close(self):
        self.db.close()

    def read(self, agent, message_id):
        row = self.db.execute('SELECT * FROM messages WHERE id=? AND (sender=? OR recipient=?)',
                              (message_id, agent, agent)).fetchone()
        if not row:
            raise ValueError('Message does not exist for this agent.')
        return dict(row)

    def send(self, sender, recipient, subject, body, reply_to=None):
        if sender not in AGENTS or recipient not in AGENTS or sender == recipient:
            raise ValueError('Choose distinct codex/claude sender and recipient.')
        subject, body = subject.strip(), body.strip()
        if not subject or len(subject) > 200 or not body or len(body) > 16000:
            raise ValueError('Subject must be 1–200 characters; body 1–16000 characters.')
        if reply_to:
            parent = self.read(sender, reply_to)
            if parent['recipient'] != sender or parent['sender'] != recipient:
                raise ValueError('Replies must go to the sender of an incoming message.')
        message_id = uuid.uuid4().hex
        with self.db:
            self.db.execute('INSERT INTO messages(id,sender,recipient,subject,body,sent_at,reply_to) VALUES(?,?,?,?,?,?,?)',
                            (message_id, sender, recipient, subject, body,
                             datetime.now(timezone.utc).isoformat(), reply_to))
        return self.read(sender, message_id)

    def inbox(self, agent, include_acked=False, limit=20):
        if agent not in AGENTS:
            raise ValueError('Unknown agent.')
        query = 'SELECT * FROM messages WHERE recipient=?'
        if not include_acked:
            query += ' AND acknowledged_at IS NULL'
        query += ' ORDER BY sent_at, id LIMIT ?'
        return [dict(row) for row in self.db.execute(query, (agent, limit))]

    def ack(self, agent, message_id):
        row = self.read(agent, message_id)
        if row['recipient'] != agent:
            raise ValueError('Only the recipient may acknowledge this message.')
        with self.db:
            self.db.execute('UPDATE messages SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?',
                            (datetime.now(timezone.utc).isoformat(), message_id))
        return self.read(agent, message_id)

    def wait(self, agent, timeout):
        deadline = time.monotonic() + timeout
        while True:
            messages = self.inbox(agent)
            if messages or time.monotonic() >= deadline:
                return messages
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))

    def status(self):
        result = {}
        for agent in AGENTS:
            row = self.db.execute('SELECT COUNT(*) AS total, SUM(acknowledged_at IS NULL) AS pending FROM messages WHERE recipient=?',
                                  (agent,)).fetchone()
            result[agent] = {'received': row['total'], 'pending': row['pending'] or 0}
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    send = commands.add_parser('send')
    send.add_argument('--from', dest='sender', choices=AGENTS, required=True)
    send.add_argument('--to', dest='recipient', choices=AGENTS, required=True)
    send.add_argument('--subject', required=True)
    body = send.add_mutually_exclusive_group(required=True)
    body.add_argument('--body')
    body.add_argument('--body-file', help='UTF-8 file, or - to read stdin')
    send.add_argument('--reply-to')
    for command in ('inbox', 'read', 'ack', 'wait'):
        sub = commands.add_parser(command)
        sub.add_argument('--agent', choices=AGENTS, required=True)
        if command in ('read', 'ack'):
            sub.add_argument('--id', required=True)
        if command == 'inbox':
            sub.add_argument('--include-acked', action='store_true')
        if command == 'wait':
            sub.add_argument('--timeout', type=int, choices=range(0, 61), metavar='0..60', default=20)
    commands.add_parser('status')
    args = parser.parse_args()
    mailbox = Mailbox()
    try:
        if args.command == 'send':
            content = args.body
            if args.body_file:
                content = sys.stdin.read(16001) if args.body_file == '-' else Path(args.body_file).read_text(encoding='utf-8')
            result = mailbox.send(args.sender, args.recipient, args.subject, content, args.reply_to)
        elif args.command == 'inbox':
            result = mailbox.inbox(args.agent, args.include_acked)
        elif args.command == 'read':
            result = mailbox.read(args.agent, args.id)
        elif args.command == 'ack':
            result = mailbox.ack(args.agent, args.id)
        elif args.command == 'wait':
            result = mailbox.wait(args.agent, args.timeout)
        else:
            result = mailbox.status()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, sqlite3.Error) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    finally:
        mailbox.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
