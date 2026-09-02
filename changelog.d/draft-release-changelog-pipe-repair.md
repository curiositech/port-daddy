type: fixed

- Prevented release discovery from rejecting a valid large changelog when an early successful match caused `git show` to receive `SIGPIPE`. Missing headers and genuine Git read failures still stop publication.
