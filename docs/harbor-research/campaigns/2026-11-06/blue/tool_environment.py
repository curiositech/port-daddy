#!/usr/bin/env python3
"""Reviewed installed-tool environment: retain identity; all mutable caches private."""
import os,pwd,sys
from pathlib import Path
cache=Path(__file__).parent/'.cache'
identity_home=pwd.getpwuid(os.getuid()).pw_dir
env={'HOME':identity_home,'RUSTUP_HOME':identity_home+'/.rustup','CARGO_HOME':str(cache/'cargo-home'),
     'CARGO_TARGET_DIR':str(cache/'target'),'CARGO_NET_OFFLINE':'true','RUSTUP_AUTO_INSTALL':'0',
     'PATH':identity_home+'/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin',
     'TMPDIR':str(cache/'tmp'),'LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'}
os.execve(sys.argv[1],sys.argv[1:],env)
