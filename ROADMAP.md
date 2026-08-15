# Quarry Roadmap

High-level roadmap for the high-performance secret and credential scanner.

## v1.1 — Entropy & Pattern Enhancements
- **Multi-Cloud Credential Heuristics**: Fine-grained regex and Shannon entropy detectors for GCP, AWS, Azure, and SaaS API tokens.
- **Git History Deep Scan**: Parallel chunked commit history parsing with tree-sitter AST validation.

## v1.2 — IDE & CI Integration
- **Pre-commit Fast Hook**: Sub-10ms staged diff scanner for developer pre-commit hooks.
- **SARIF Report Generation**: Standardized static analysis format output for GitHub Code Scanning integration.

## Out of Scope
- Online token validity probing (offline scanning only)
- Automatic code patching of exposed credentials

---
For detailed RFCs and implementation notes, see [`docs/specs/`](docs/specs/).
