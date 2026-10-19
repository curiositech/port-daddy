# Capture authorization and retention procedure

This is an engineering control pattern, not a legal consent determination. Configure a current qualified review process for the deployment's jurisdiction, role, data types and purpose.

## Before opening a source

For each camera, microphone, screen feed, meeting bridge, email connector, or other capture route, bind a short-lived receipt to: exact source/channel, actor or workspace authority, declared purpose, allowed data scope and derivatives, notice/authority result, policy revision, start and expiry, and pause/stop route. Default to disabled. Validate the receipt before activating the sensor, stream, transcription, or OCR. If a field is missing, expired, revoked, or unknown, leave the source closed. A post-capture classifier/redaction step cannot undo collection.

Recheck expiry and revocation while the source remains open. `pause` stops new acquisition while retaining only data already authorized by the policy; `stop` closes all configured sources. These control states do not imply existing data has been deleted.

## Derivative inventory and deletion state

Keep lineage for each declared derivative: raw capture/transcript, normalized record, summary/fact, embedding, search cache, export, backup, and provider-side copy where queryable. Do not put payloads in the lineage ledger by default. A deletion request begins the workflow; mark each destination `pending`, query by stable identifier after deletion/invalidation, and test restore/cache paths. Report `verified absent` only for stores and paths actually checked. Mark unqueryable or immutable copies `unknown` or `restricted_legal_hold`, with a responsible owner and review date.

Separate new-collection disablement, access restriction, delete request, verified deletion, and legal/contractual hold. A hold must have a separate authority reference, purpose and scope, expiry/review point, restricted access, and a path to release; its existence is not a general permission to retain other data.

See [primary deletion and provenance methods](primary-methods-and-boundaries.md#deletion-lineage-and-learned-influence). Their access limits preclude claiming generic foundation-model unlearning.
