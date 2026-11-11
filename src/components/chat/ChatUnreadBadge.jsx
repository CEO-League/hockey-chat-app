import { useStreamSession } from './StreamContext';
export default function ChatUnreadBadge() {
  const { unread = 0 } = useStreamSession() ?? {};
  return unread > 0 ? <span className="hockey-chat-badge" aria-label={`${unread} unread messages`}>
    {unread > 99 ? '99+' : unread}
  </span> : null;
}
