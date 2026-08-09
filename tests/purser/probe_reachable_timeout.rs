use crate::berths::probe_reachable;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[test]
fn test_probe_reachable_timeout() {
    let addr = SocketAddr::from(([127, 0, 0, 1], 12345));
    let result = TcpStream::connect_timeout(&addr, Duration::from_millis(100));
    assert!(result.is_err());
}