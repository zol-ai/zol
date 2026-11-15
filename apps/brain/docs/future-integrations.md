# Future integrations

This document records possible additions after the task-management MVP is stable. Company Brain currently answers read-only questions from Firestore; the external integrations below are not implemented.

## Google Drive documents

A future Documents area could let approved users link Drive files to clients and tasks. It should use Google OAuth scopes incrementally, request the narrowest Drive scope possible, store file metadata rather than file contents, and respect the existing server authorization boundary. The current sidebar item is intentionally disabled and makes no Drive API calls.

## Google Calendar

Task due dates could later appear as calendar events. The design should define whether Company OS owns events or only links to them, handle updates and deletions idempotently, and avoid requesting calendar access until the user explicitly enables synchronization.

## Gmail

Client records could optionally link to relevant message threads. A future design must minimize Gmail scopes, avoid storing message bodies by default, support disconnect and data deletion, and pass any Google OAuth verification required for sensitive scopes.

## Company Brain expansion

Company Brain uses an extensible, allowlisted tool registry. Future tools can add Calendar, Gmail, and Drive context without giving the model generic API or database access. Each integration should use narrowly scoped OAuth permissions, return bounded and redacted results, and treat external content as untrusted data.

Write actions may be added later, but every mutation must show a preview, require explicit user confirmation, and create an audit record. Embeddings, vector databases, autonomous agents, and document summarization remain outside the current scope.
