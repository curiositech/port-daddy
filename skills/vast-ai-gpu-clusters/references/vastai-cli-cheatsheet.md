# Vast.ai CLI Command Cheatsheet

## 1. Authentication & Account Balance
```bash
vastai set api-key YOUR_API_KEY
vastai show user
```

## 2. Searching for Hardware Offers

### Filter by GPU architecture, VRAM, and network speed:
```bash
# Single RTX 4090 with >200 Mbps down, reliable host, < $0.40/hr
vastai search offers 'gpu_name = RTX_4090 inet_down > 200 reliability > 0.95 dph < 0.40' -o 'dph'

# High-memory A100 (80GB) for large simplicial complexes (N > 10^5)
vastai search offers 'gpu_name = A100_SXM4_80GB num_gpus = 1 inet_down > 500' -o 'dph'
```

## 3. Instance Creation & SSH Connection

```bash
# Create on-demand PyTorch instance with 40GB NVMe disk
vastai create instance OFFER_ID \
  --image pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime \
  --disk 40 \
  --label "sheaf-admm-run"

# Check instance status until RUNNING
vastai show instances

# Get SSH connection string (port and host)
vastai ssh-url INSTANCE_ID
```

## 4. Teardown & Spend Protection

```bash
# IMMEDIATE DESTRUCTION (Stops storage disk charges)
vastai destroy instance INSTANCE_ID

# List all running instances to verify zero orphan billing
vastai show instances
```
