type: added

- Harbor editor gains explicit Cmd-S/Ctrl-S local text saving with exact-revision dirty state, detected disk-change refusal, serialized local writes and metadata preservation or refusal. Linked files remain readable without overwrite authority. Saving text does not establish shared acceptance or preserve crash-safe CRDT history; native interaction proof remains pending.
