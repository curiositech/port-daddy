#!/bin/sh
# Reviewed fixed proof workload. This file is only executed inside the VM.
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
/bin/busybox --install -s /bin
mkdir -p /proc /sys /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
modprobe virtio_blk 2>/dev/null || true
sleep 1
echo PROOF_BOOTED
if [ -b /dev/vda ] && [ -b /dev/vdb ]; then echo PROOF_TWO_DISKS; fi
own=$(dd if=/dev/vda bs=1 count=128 2>/dev/null | tr -d '\000')
echo "PROOF_OWN_INPUT=$own"
if printf 'forbidden' | dd of=/dev/vda bs=1 conv=notrunc 2>/dev/null; then
    echo PROOF_READONLY_FAILED
else
    echo PROOF_READONLY_DENIED
fi
if printf 'guest-state-ok' | dd of=/dev/vdb bs=1 conv=notrunc 2>/dev/null; then echo PROOF_STATE_WRITE_OK; fi
if [ ! -e /dev/vdc ] && [ ! -e /Users ] && [ ! -e /host ] && [ ! -e /mnt/other-team ] && ! dd if=/dev/vdc of=/dev/null bs=1 count=1 2>/dev/null; then
    echo PROOF_CROSSREAD_ABSENT
fi
if [ "$(ls /sys/class/net)" = lo ]; then echo PROOF_ONLY_LOOPBACK; fi
if ! command -v timeout >/dev/null || ! command -v wget >/dev/null; then
    echo PROOF_NETWORK_TOOL_MISSING
elif timeout 2 wget -q -O /dev/null http://192.0.2.1/ 2>/dev/null; then
    echo PROOF_NETWORK_FAILED
else
    echo PROOF_NETWORK_DENIED
fi
echo PROOF_DONE
sync
poweroff -f
