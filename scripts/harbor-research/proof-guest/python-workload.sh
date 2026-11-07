# Included only in the reviewed Python guest initramfs. Never run on the host.
mkdir -p /proof
dd if=/dev/vda bs=4096 skip=1 2>/dev/null | tar -xf - -C /proof
actual=$(sha256sum /proof/payload.py | cut -d ' ' -f 1)
negative=$(sha256sum /proof/negative.py | cut -d ' ' -f 1)
if [ "$actual" != '@PAYLOAD_SHA256@' ] || [ "$negative" != '@NEGATIVE_SHA256@' ]; then
    echo PYTHON_PAYLOAD_HASH_MISMATCH
else
    echo PYTHON_PAYLOAD_HASH_OK
    /usr/bin/python3 -I -B --version
    sha256sum /usr/bin/python3.12
    echo PYTHON_POSITIVE_BEGIN
    timeout 35 /usr/bin/python3 -I -B /proof/payload.py
    positive=$?
    echo "PYTHON_POSITIVE_EXIT=$positive"
    echo PYTHON_NEGATIVE_BEGIN
    timeout 5 /usr/bin/python3 -I -B /proof/negative.py
    negative=$?
    echo "PYTHON_NEGATIVE_EXIT=$negative"
    if [ "$negative" = 1 ]; then echo PYTHON_NEGATIVE_CONTROL_OK; fi
fi
