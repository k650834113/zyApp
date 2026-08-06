# SSH 部署身份防错设计

## 背景与目标

ZyApp 当前部署脚本要求调用者手工传入服务器、SSH 用户和私钥路径。2026-08-06 排障确认：`C:\Users\泉\.ssh\id_rsa` 会被服务器拒绝；正确私钥是 `E:\证书\codex.pem`，对应已授权公钥，能够以 `ubuntu@124.220.69.209` 登录。

本设计的目标是让直接 SSH 和仓库部署脚本都使用同一份明确身份，并在任何网络连接之前拒绝错误私钥。私钥内容不得进入 Git、日志、测试夹具或部署产物。

## 已确认的部署身份

- SSH 别名：`zyapp-server`
- 服务器：`124.220.69.209`
- 用户：`ubuntu`
- 本机私钥：`E:\证书\codex.pem`
- 已授权公钥指纹：`SHA256:wiCYUxW2h/Y81rAWgN6uwYfq2IZ7HVuUdV67XhbdIS0`

公钥本身不是秘密，可以作为仓库中的身份基准；私钥只能保留在仓库外。

## 方案

### 本机 SSH 单一入口

在当前 Windows 用户的 `~/.ssh/config` 中维护 `zyapp-server`：

```sshconfig
Host zyapp-server
  HostName 124.220.69.209
  User ubuntu
  IdentityFile E:/证书/codex.pem
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking accept-new
```

配置必须保留文件中已有的其他 Host 段。应用后以 `ssh zyapp-server true` 做只读验证。

同时设置用户级环境变量 `ZYAPP_SSH_KEY_PATH=E:\证书\codex.pem`，供新的 PowerShell、Codex 和部署脚本读取。部署脚本也读取用户级环境变量，因此设置后无需重启当前进程才能解析路径。

### 仓库中的非秘密身份基准

仓库新增：

- `infra/deploy/zyapp-deploy.pub`：用户提供的完整 SSH 公钥。
- `infra/deploy/ssh-identity.json`：记录服务器、用户、公钥文件和环境变量名称，不记录私钥路径或内容。
- `infra/scripts/resolve-deployment-ssh-identity.ps1`：统一解析并验证部署身份。

解析器按以下顺序取得私钥路径：

1. 调用者显式传入的 `-KeyPath`；
2. 当前进程的 `ZYAPP_SSH_KEY_PATH`；
3. Windows 用户级的 `ZYAPP_SSH_KEY_PATH`。

解析器使用 `ssh-keygen -lf` 分别计算基准公钥和候选私钥的 SHA-256 指纹。只有指纹完全一致时才返回规范化的服务器、用户、私钥路径和 SSH 参数；否则在本地终止，并显示预期及实际指纹。输出不得包含私钥内容。

### 部署脚本接入

以下入口统一调用身份解析器：

- `deploy-production.ps1`
- `deploy-test-release.ps1`
- `deploy-miniapp-production.ps1`
- `deploy-miniapp-production-test.ps1`

`HostName`、`SshUser` 和 `KeyPath` 保留为可选覆盖参数，以兼容显式调用；省略时读取仓库身份基准和本机环境变量。无论采用默认值还是显式值，私钥都必须通过指纹校验。

身份校验发生在生成压缩包、读取发布产物、上传文件或执行远程命令之前。传入旧的 `id_rsa` 时，脚本必须报告“部署私钥指纹不匹配”，而不是进入 SSH 后才得到笼统的 `Permission denied (publickey)`。

## 错误处理与安全边界

- 私钥文件不存在：本地失败，提示设置 `ZYAPP_SSH_KEY_PATH` 或传入 `-KeyPath`。
- 缺少 `ssh`、`scp` 或 `ssh-keygen`：本地失败并指出缺少的命令。
- 指纹不匹配：本地失败，不尝试网络连接。
- 正确密钥但服务器拒绝：保留原始 SSH 退出码和目标别名，提示检查服务器 `authorized_keys`。
- 私钥、设备令牌、支付密钥和 BGG Token 不得写入日志；SSH 公钥及其指纹可以记录。
- 本次变更不修改服务器 `authorized_keys`，因为正确公钥已经获得服务器授权。

## 测试与验收

自动化测试使用临时生成的测试密钥，不依赖或复制真实私钥：

1. 匹配的临时私钥/公钥能够解析成功。
2. 错误私钥在任何 SSH 调用前被拒绝。
3. 显式 `-KeyPath` 优先于环境变量。
4. 缺少路径时给出可操作的错误信息。
5. 现有发布契约测试和四个部署脚本的参数验证继续通过。

本机验收：

1. `ssh zyapp-server true` 返回退出码 0。
2. 身份解析器对 `E:\证书\codex.pem` 返回已确认指纹。
3. 身份解析器对 `C:\Users\泉\.ssh\id_rsa` 在本地明确拒绝。
4. 仓库与生成的部署产物中不包含 `codex.pem` 私钥内容。

## 非目标

- 不轮换服务器 SSH 公钥。
- 不复制、移动或重新编码私钥文件。
- 不改变生产服务、数据库、Docker 容器或防火墙。
- 不在本次身份防错工作中执行生产部署。
