# Unrolled Sheaf Diffusion & GPU PyTorch Setup

## Why Neural Sheaf Diffusion Requires Dedicated GPUs

In traditional cellular sheaves, restriction maps $P_e$ are fixed Boolean projection matrices, which solve via conjugate gradient in milliseconds on CPU.
However, in **Neural Sheaf Diffusion (Bodnar et al. 2022)** and **Parameterized Sheaf-ADMM (Seely et al. 2026)**:
1. Restriction maps are parameterized matrices $P_e(\theta) \in \text{St}(d, D)$ on the Stiefel manifold.
2. The sheaf Laplacian $L_{\mathcal{F}}(\theta) = \delta_0^T \delta_0$ becomes a non-linear function of learned parameters $\theta$.
3. Backpropagation through $K$ steps of unrolled diffusion requires:
   $$\frac{\partial \mathcal{L}}{\partial \theta} = \sum_{k=1}^K \left( \frac{\partial x^{(k)}}{\partial L_{\mathcal{F}}} \frac{\partial L_{\mathcal{F}}}{\partial \theta} \right)$$
   This demands dense batch matrix multiplications and SVDs on GPU VRAM.

## Minimal PyTorch Installation & Verification Script

```python
import torch

def verify_gpu_topology():
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA device not detected. Ensure NVIDIA drivers are active.")
    device = torch.device("cuda:0")
    print(f"[GPU Topology] Device: {torch.cuda.get_device_name(device)}")
    print(f"[GPU Topology] Memory Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")
    
    # Test batch sparse-dense tensor contraction
    N, d, D = 10000, 4, 16
    P = torch.randn(N, d, D, device=device)
    x = torch.randn(N, D, device=device)
    Px = torch.bmm(P, x.unsqueeze(-1)).squeeze(-1)
    print(f"[GPU Topology] Benchmark bmm contraction successful: shape {Px.shape}")

if __name__ == "__main__":
    verify_gpu_topology()
```
