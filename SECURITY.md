# Security reporting

Please do not publish vulnerabilities, exploit details, credentials, email contents, or authentication links in public issues or pull requests.

Use the repository's **Security → Report a vulnerability** option to contact maintainers privately when it is available. If it is not available, open a minimal issue asking for a private security contact without disclosing the vulnerability. Maintainers must enable GitHub private vulnerability reporting before the public launch.

Include the affected revision, deployment mode, impact, reproduction steps using synthetic data, and any suggested mitigation in the private report. Do not include real credentials or recipient data. No response-time or backport guarantee is currently offered; fixes are developed against the current main branch.

Operators of independent installations are responsible for updates, AWS/DNS access, backup access, SES configuration and their own operational controls. Review the architecture, deployment and message-retention documentation before accepting production traffic.
