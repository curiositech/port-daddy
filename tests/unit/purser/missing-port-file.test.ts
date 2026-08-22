import os

# LangChain chains use PORT_DADDY_URL if set; else discover from daemon.port
base_url = os.getenv('PORT_DADDY_URL')
if not base_url:
    daemon_port_file = os.path.expanduser('~/.port-daddy/daemon.port')
    if os.path.exists(daemon_port_file):
        with open(daemon_port_file) as f:
            daemon_port = f.read().strip()
        base_url = f'http://localhost:{daemon_port}'
    else:
        raise RuntimeError('Daemon not found. Check FleetBar Control Center for daemon status.')

from portdaddy_langchain import PortDaddyToolkit
tools = PortDaddyToolkit(base_url=base_url)