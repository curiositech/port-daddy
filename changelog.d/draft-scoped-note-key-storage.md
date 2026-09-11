type: fixed

- Session-note master-key files now follow `PD_HOME`. An explicit noncanonical root requires `PORT_DADDY_DISABLE_KEYCHAIN=1`, preventing accidental use of the canonical note-key Keychain account. Scoped storage requires an owned real 0700 directory and a regular, single-link 0600 key file; bounded nonblocking reads, exclusive creation, and pathname revalidation reject startup races. Invalid existing file or Keychain keys are never regenerated. This is a note-key boundary, not a claim that every berth secret is isolated or that a new runtime is installed.
