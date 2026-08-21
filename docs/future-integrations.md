# Future integrations

This document records possible additions after the task-management MVP is stable. None of these integrations are implemented, configured, or requested by the current application.

## Google Drive documents

A future Documents area could let approved users link Drive files to clients and tasks. It should use Google OAuth scopes incrementally, request the narrowest Drive scope possible, store file metadata rather than file contents, and respect the existing server authorization boundary. The current sidebar item is intentionally disabled and makes no Drive API calls.

## Google Calendar

Task due dates could later appear as calendar events. The design should define whether Company OS owns events or only links to them, handle updates and deletions idempotently, and avoid requesting calendar access until the user explicitly enables synchronization.

## Gmail

Client records could optionally link to relevant message threads. A future design must minimize Gmail scopes, avoid storing message bodies by default, support disconnect and data deletion, and pass any Google OAuth verification required for sensitive scopes.

## AI assistant

An assistant could help draft task descriptions or summarize user-selected workspace data. It should be opt-in, disclose the model provider and data sent, avoid training on company content, keep an audit trail for mutations, and require confirmation before changing tasks. Model providers, agents, embeddings, vector databases, and document summarization are deliberately absent from the MVP.
