# LinguaDE 部署指南 · 华为云 ECS（auto-deploy，Docker Compose 形态）

> 目标：把系统部署到一台华为云 ECS，拿到公网演示地址。
> 形态：`frontend`（nginx 托管单文件产物）+ `backend`（FastAPI/uvicorn），nginx 把 `/api` 反代到后端（同源，SSE 需关闭缓冲）。
> 比赛默认：**HTTP 8080，无需证书**；备案与证书就绪后再切 HTTPS（见第九节）。

---

## 一、当前环境探测结论（2026-10 实测）

| 检查项 | 状态 | 说明 |
|---|---|---|
| bash（Git 自带） | ✅ | `C:\Program Files\Git\bin\bash.exe` |
| ssh / scp / ssh-keygen | ✅ | Git 自带，可用于上传与远程执行 |
| 华为云 API 网络 | ✅ | 已连通 `iam.myhuaweicloud.com:443` |
| Terraform 镜像网络 | ✅ | 已连通 `mirrors.huaweicloud.com:443` |
| SSH 白名单匹配 | ✅ | 当前公网 IP 与 auto-deploy 探测一致（`/32`） |
| **terraform** | ❌ | 未安装 —— **需补** |
| **华为云 AK/SK** | ❌ | 未设置 —— **需补** |
| docker / rsync | ❌ | 非必需（ECS 侧由部署脚本安装 docker；rsync 可选） |

> 结论：**补齐 terraform 与 AK/SK 两项后即可一键部署。**

---

## 二、第 0 步：拿到华为云 AK/SK

1. 登录华为云控制台 → 右上角头像 → **我的凭证** → **访问密钥** → **新增访问密钥**；
2. 下载 `credentials.csv`（**只提供这一次下载**，含 Access Key / Secret Key）；
3. 权限建议：`ECS FullAccess` + `VPC FullAccess` + `EIP FullAccess`（或 `Tenant Administrator`）；
4. **安全**：AK/SK 只写入本机环境变量，**不要**写进代码、不要提交仓库、不要发给任何人（包括我）。

---

## 三、第 1 步：安装 Terraform（Windows）

### 方式 A · 便携版（推荐，不污染系统）
```powershell
# 1) 下载（版本以镜像目录为准，示例 1.9.8）
$ver = '1.9.8'
$url = "https://mirrors.huaweicloud.com/terraform/$ver/terraform_${ver}_windows_amd64.zip"
Invoke-WebRequest $url -OutFile "$env:TEMP\terraform.zip"

# 2) 解压到工程内（例如 tools\terraform）
New-Item -ItemType Directory -Force 'D:\111\华为ict\linguade\tools\terraform' | Out-Null
Expand-Archive "$env:TEMP\terraform.zip" -DestinationPath 'D:\111\华为ict\linguade\tools\terraform' -Force

# 3) 本次会话加入 PATH
$env:PATH = "D:\111\华为ict\linguade\tools\terraform;$env:PATH"

# 4) 验证
terraform version
```

### 方式 B · winget
```powershell
winget install --id Hashicorp.Terraform -e
```
（安装后重开终端，`terraform version` 可验证）

---

## 四、第 2 步：设置凭证（仅本机终端）

```powershell
$env:HW_ACCESS_KEY = "<你的 Access Key>"
$env:HW_SECRET_KEY = "<你的 Secret Key>"
```
- 仅对**当前终端会话**有效（关闭即失效，最安全）；
- 如需长期生效：`setx HW_ACCESS_KEY "..."`（注意 setx 会明文写入用户环境变量，谨慎）。

---

## 五、第 3 步：先出计划（不创建任何资源，不花钱）

```powershell
cd D:\111\华为ict\linguade
python tools/build.py                                    # 确保 dist 最新
python ..\auto-deploy-repo\scripts\auto_deploy.py --repo . --app-name linguade --region cn-north-4 --plan-only
```
产物在 `linguade\.auto-deploy\`（`analysis.json`、`resource-spec.json`、`deployment-plan.md`）。
若这里仍报 `terraform not found` 或凭证缺失，回到第 1/2 步。

---

## 六、第 4 步：正式部署

```powershell
python ..\auto-deploy-repo\scripts\auto_deploy.py --repo . --app-name linguade --region cn-north-4 `
  --flavor-tier small --app-port 8080 --yes
```

**可选：把华为云 AI 能力接上**（推荐用于参赛演示）
```powershell
python ..\auto-deploy-repo\scripts\auto_deploy.py --repo . --app-name linguade --region cn-north-4 `
  --flavor-tier small --yes `
  --env LINGUADE_LLM_BASE_URL="<MaaS/ModelArts Studio 的 OpenAI 兼容地址>" `
  --env LINGUADE_LLM_API_KEY="<你的模型 API Key>" `
  --env LINGUADE_LLM_MODEL="deepseek-chat" `
  --env LINGUADE_ASR_BASE_URL="<昇腾 Whisper 推理服务地址>"
```

**可选增强通道（3.7.0）**：音素评估与知识追踪**默认走零依赖本地实现**（`rule` / `bkt`），
不配置任何外部服务也完全可用。若已有「声学发音评估」或「深度知识追踪」推理服务，可切换为外部通道：

```powershell
  --env LINGUADE_PHONEME_CHANNEL="acoustic" `
  --env LINGUADE_PHONEME_BASE_URL="http://<声学评估服务>" `   # 约定 POST {base}/assess  body={ref,hyp,meta}
  --env LINGUADE_KT_CHANNEL="dkt" `
  --env LINGUADE_KT_BASE_URL="http://<KT 推理服务>"           # 约定 POST {base}/predict body={skill,history}
```

启用后 `/api/health` 的 `phoneme.effective` / `kt.effective` 会显示 `acoustic` / `dkt`；
外部服务不可用时**自动回落** `rule` / `bkt`（响应带 `source:"fallback"` 与 `message`），前端主流程无感。

**发音合成 TTS（3.14.0，可选）**：给词表/例句补发音（前端三级回落：Tatoeba 实人录音 → 后端 TTS → 浏览器语音合成）。
`off`（默认）零配置可用。德语内容推荐 `siliconflow` 通道（语言 API Key）：

```powershell
  --env LINGUADE_TTS_CHANNEL="siliconflow" `
  --env LINGUADE_SILICONFLOW_API_KEY="sk-..." `
  --env LINGUADE_SILICONFLOW_TTS_VOICE="<HeyGen 音色 UUID（10 个默认音色见模型页「API」标签）；留空走 CosyVoice2 兜底>" `
```

说明：默认模型 `heygen/heygen-voice-1-turbo` 平台标注免费至 2026-11-30，失效自动降级 `FunAudioLLM/CosyVoice2-0.5B`；
华为云 SIS 通道（`LINGUADE_TTS_CHANNEL="hwcloud"`，AK/SK 复用 OCR 的）官方音色表仅中英文，适合中文/英文音频。
批量离线生成用 `python tools/tts_generate.py`（词表 → mp3/wav + manifest 清单，可回填内容库音频列）。
`/api/health` 的 `tts.ready` 显示通道就绪状态。

要点：
- 本工程是**前后端分离**形态，auto-deploy 会走 **Docker Compose** 部署路径（国内网络下会使用镜像加速）；
- 资源规格默认按项目类型自动选择（非 Java 应用 → `small`：2 vCPU / 4 GB）；
- `--env` 注入的配置**只记录键名**，不会把值写进报告。

---

## 七、第 5 步：验证

1. 查看报告：`linguade\.auto-deploy\` 下的部署报告（含 EIP 公网 IP、健康检查结果）；
2. 浏览器打开 `http://<EIP>:8080` → 应看到 LinguaDE 首页；
3. 前端「设置 → 后端 API」填 `http://<EIP>:8080`（nginx 已把 `/api` 转发到后端），打开抽屉应看到**状态徽标**；
4. 对话页发送一句德语，若已配置大模型，顶部应显示「云端大模型驱动」且回复逐字流式。

---

## 八、第 6 步：用完清理（省钱，重要）

```powershell
python ..\auto-deploy-repo\scripts\destroy.py --workdir "<terraform workdir>"
```
- `terraform workdir` 见报告（通常位于 `linguade\.auto-deploy\` 下）；
- `destroy.py` 只销毁 Terraform state 管理的资源；
- **注意**：ECS + EIP 按量计费，演示结束后务必销毁；若额外开了 MaaS/ModelArts/RDS，需另行关闭。

---

## 九、重要边界（来自 auto-deploy SKILL）

- 本技能**只创建单台 ECS**，**不会创建** RDS / Redis / OBS / MQ / ELB / CCE；
- Compose 默认只映射 **8080**（容器内 nginx 监听 8080，配置为 `deploy/nginx.http.conf`，无证书依赖）；安全组只开 22 与 8080，访问地址形如 `http://<EIP>:8080`；
- 健康检查路径为 **`/api/health`**，由前端容器的 nginx 反代到后端容器（`deploy/nginx.http.conf` 已配置）；
- 本工程后端**默认 SQLite**，零外部依赖即可跑通演示；比赛要求关联 RDS/Redis 时按第九 A 节开通并注入；
- SSH（22）默认只放行控制机公网 IP；如需全网开放必须显式 `--ssh-cidr 0.0.0.0/0`（不建议）；
- AK/SK 只从环境变量读取，不会写入生成的任何文件；
- 部署失败可断点续跑：`--resume-from deploy` / `--resume-from verify`；
- 切 HTTPS：设 `LINGUADE_NGINX_CONF=nginx.conf`、`LINGUADE_HTTP_PORT=80`，并重新挂载 `deploy/certs`、映射 80/443（参考 `deploy/nginx.https.conf` 顶部说明）。

## 九 A、接入华为云 RDS for PostgreSQL + Redis（赛题一必需）

> 目标：`/api/health` 返回 `database: postgresql` 且 `redis: true`；注册/登录/同步真实读写云数据库。
> 顺序建议：**先部署 ECS → 在同一 VPC 开通 RDS/Redis → 注入连接串 → 重建 backend**。这样网络最省事。

### 1. 开通 RDS for PostgreSQL

1. 控制台 → 云数据库 RDS → 购买 **PostgreSQL**（演示选最小规格、按需计费，区域与 ECS 一致，如 `cn-north-4`）。
2. **网络**：选择与 ECS **相同的 VPC 和子网**（ECS 的 VPC ID 见 `.auto-deploy/deployment-test-report.md` 或 ECS 控制台）。
3. 创建数据库 `linguade`（字符集默认 UTF8）；记下内网地址、端口 `5432`、用户名、密码。
4. 安全组：入方向放行 `5432`，来源填 **ECS 的私网 IP/32** 或 ECS 所在子网网段；不要对 `0.0.0.0/0` 开放。

### 2. 开通 Redis

1. 控制台 → 分布式缓存服务 Redis → 购买最小规格（同区域、**同 VPC/子网**），设置密码。
2. 记下内网地址、端口 `6379`。
3. 安全组：入方向放行 `6379`，来源仅 ECS 私网 IP/子网。

### 3. 注入连接串并重启后端

**方式 A（推荐，部署时一次注入）**：在部署命令后追加：

```powershell
  --env "LINGUADE_DATABASE_URL=postgresql+asyncpg://<user>:<password>@<rds-private-ip>:5432/linguade" `
  --env "LINGUADE_REDIS_URL=redis://:<redis-password>@<redis-private-ip>:6379/0"
```

auto-deploy 会把变量写入 ECS 上的 `/opt/auto-deploy/linguade/current/.env`，并在重建时保留。

**方式 B（部署后修改）**：

```bash
ssh -i .auto-deploy/keys/auto-deploy-key-linguade root@<EIP>
cd /opt/auto-deploy/linguade/current
sudo nano .env   # 追加 DATABASE_URL / REDIS_URL
sudo docker compose up -d --force-recreate backend
```

`.env` 内容示例：

```bash
LINGUADE_DATABASE_URL=postgresql+asyncpg://<user>:<password>@<rds-private-ip>:5432/linguade
LINGUADE_REDIS_URL=redis://:<redis-password>@<redis-private-ip>:6379/0
LINGUADE_COOKIE_SECURE=0
```

- 密码含 `@ : / ? #` 等字符时必须做 URL 编码（如 `@` → `%40`）；含 `$` 或空格时用单引号包住整个值；
- 首次启动会自动建表（`init_db` → `create_all`），无需手工导 schema；
- 重建后端：`sudo docker compose up -d --force-recreate backend`。

### 4. 验证（必须真实执行）

```bash
# ECS 上
curl -s http://127.0.0.1:8080/api/health
# 期望包含："database":"postgresql" 且 "redis":true

# Redis 真实连通（health 的 true 只代表配置了 URL）
redis-cli -h <redis-private-ip> -p 6379 -a '<redis-password>' ping
# 期望：PONG

# 业务写库：打开 http://<EIP>:8080 → 注册/登录 → 做一次练习 → 刷新/换设备恢复，数据仍在
```

> 注意：`/api/health` 的 `redis` 字段只表示“已配置连接串”，不代表实际连通；必须用 `redis-cli ping` 与业务读写二次确认。Redis 暂不可达时后端已回落进程内缓存，不会 500，但赛题演示仍应保证真实连通。

### 5. 清理

`auto-deploy` 的 `destroy.py` **只销毁 Terraform state 中的 ECS/EIP/VPC**；RDS 与 Redis 需在控制台单独退订/删除，避免持续计费。

---

## 十、没有云端环境时的降级演示方案

即使不做部署，系统本身**完全可离线演示**：

- 直接双击 `dist\index.html`（`file://`）→ 全部 18 个模块、算法沙盘、离线规则引擎均可用；
- 想演示「云端 AI 链路」：本地跑 `python tools/mock_backend.py --port 8899` + `python -m http.server 8899`，前端「后端 API」填 `http://127.0.0.1:8899`，即可展示三层降级与 SSE 流式。

---

## 十一、故障排查速查

| 现象 | 处理 |
|---|---|
| `terraform not found in PATH` | 执行第三节，确认 `terraform version` 可输出 |
| `huaweicloud_credentials: fail` | 第四节的环境变量未生效（注意：`setx` 后需**重开终端**） |
| `VPC conflict` | auto-deploy 会先做 VPC 冲突预检；可改用 `--network-mode reuse --existing-vpc-id ... --existing-subnet-id ...` |
| 部署超时（docker 拉取慢） | 增大 `--docker-build-timeout`（默认 2400s），或提供 `--docker-registry-mirrors` |
| 前端能开、AI 不可用 | 检查「设置 → 后端 API」是否填写，以及后端 `/api/health` 的 `llm/asr` 是否为 true |