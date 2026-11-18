# LinguaDE 部署指南 · 阿里云 / 腾讯云

> 目标：把本仓库的站点部署到公网，拿到可访问地址。
> 本文对照 `docs/deploy-guide.md`（华为云 auto-deploy 形态），给出**换到阿里云或腾讯云**的路线选型、具体配置规格、上线前必改项和操作步骤。
> 适用版本：前端 `dist/index.html`（v3.7.0）+ 后端 FastAPI（`backend/app/main.py`）。

---

## 一、项目形态结论（决定选型）

| 组件 | 现状 | 对部署的影响 |
|---|---|---|
| 前端 | `dist/index.html` 单文件产物 608 KB，零外部请求；另有 `dist/content-pack-*.json` 约 616 KB | **可纯静态托管**（OSS/COS），也可 nginx 托管 |
| PWA | `deploy/manifest.webmanifest`、`deploy/sw.js`、`deploy/icon*.svg` | 安装与 Service Worker **要求 HTTPS**（`http://IP:8080` 形态下不可安装） |
| 后端 | `deploy/Dockerfile.backend`：`python:3.12-slim` + uvicorn，监听 8000，**可选** | 留空所有 AI 配置时前端自动降级，后端只做数据同步 |
| 反代 | `deploy/nginx.conf`：`/api/` → `http://backend:8000`，已 `proxy_buffering off`（SSE 必需） | 前后端同源，免 CORS；加 CDN/负载均衡时**必须保持关缓冲** |
| 数据 | `sqlite+aiosqlite:///./linguade.db`，**`docker-compose.yml` 未挂 volume** | 容器重建即丢数据，见第四节第 3 条 |
| 端口 | compose 映射 `8080:80` | 域名形态需改 `80:80` + `443:443` |
| 密钥 | `deploy/env.example` 给出 7 个 `LINGUADE_*` 变量；`backend/app/config.py` 实际支持 13 个（含 phoneme / kt 通道） | 全部可留空；走 `.env` 注入，**不提交仓库** |

> 注：工作区内 `lingo-de-v3/` 是 v3 的旧快照，`auto-deploy-repo/` 是部署技能本身，真正要上线的是 `linguade/`。

---

## 二、三条路线选型

| 路线 | 适用场景 | 阿里云 | 腾讯云 | 月成本量级 | 备案 |
|---|---|---|---|---|---|
| **A 纯静态**（最快 10 分钟） | 演示"离线优先"卖点，AI 走浏览器直连 / 本地规则引擎 | OSS 静态页面 + CDN/DCDN | COS 静态网站 + CDN/EdgeOne | ¥3–20（按流量） | 默认域名不需要；绑自有域名需要 |
| **B 单台服务器 + Docker Compose**（推荐，改动最小） | 前端 + 后端 + `/api` 同源 + SSE，功能完整 | 轻量应用服务器 2C4G，或 ECS `ecs.u1-c1m2.large` | 轻量应用服务器 2C4G，或 CVM `S5.MEDIUM4` | ¥60–130（新用户活动价可低至 ¥40–99/年） | IP:端口访问不需要；域名 + 80/443 需要 |
| **C 容器 Serverless**（正式 / 多端） | 免运维、按量伸缩 | OSS 托管前端 + 函数计算 FC 3.0 Web 函数（镜像）或 SAE + ACR | COS/EdgeOne 托管前端 + 云函数 SCF Web 函数 / TKE Serverless + TCR | ¥20–150（有调用才贵） | 同 B |

**建议**：参赛演示选 **B**；只让人打开链接看效果选 **A**；确定要长期运营再上 **C**。

---

## 三、路线 B 的具体配置选择

原华为云规格 `s6.large.2` = 2 vCPU / 4 GB（见 `.auto-deploy/resource-spec.json`），等价选型：

| 项 | 阿里云 | 腾讯云 | 说明 |
|---|---|---|---|
| 产品 | 轻量应用服务器（首选）/ ECS | 轻量应用服务器（首选）/ CVM | 轻量含固定带宽套餐，通常比 ECS/CVM 便宜一半 |
| 规格 | 2 vCPU / 4 GiB（ECS：`ecs.u1-c1m2.large`、`u2a-c1m2.large`） | 2 vCPU / 4 GiB（CVM：`S5.MEDIUM4`、`SA2.MEDIUM4`） | 仅 SQLite 时 2C2G 也够；要挂本地 Whisper/OCR 推理再上 8 GB |
| 地域 | 华东1（杭州）/ 华北2（北京） | 上海 / 广州 | 备案管局按**主体所在省**，与服务器地域无关，但提交信息需一致 |
| 镜像 | Ubuntu 22.04 LTS 64 位 | Ubuntu 22.04 LTS 64 位 | 与 `deploy/Dockerfile.*` 无冲突 |
| 系统盘 | 40 GB ESSD Entry / PL0 | 50 GB 云硬盘 SSD / 标准型 | 全站产物约 1.2 MB，容量不是瓶颈 |
| 公网 | 按固定带宽 3–5 Mbps，或按使用流量（峰值 100 Mbps） | 轻量套餐含峰值带宽（3–6 Mbps 档最划算） | 首页 gzip 后远小于 608 KB，演示带宽足够 |
| 登录用户 | 轻量 `lighthouse`；ECS 自选 `root`/`ecs-user` | 轻量 `lighthouse`；CVM `ubuntu` 或 `root` | scp/rsync 路径随之调整 |
| 密钥对 | 在线创建，或复用 `linguade/.auto-deploy/keys/auto-deploy-key-linguade.pub`（ed25519） | 同左 | 私钥在 `keys/` 下，勿提交 |

### 安全组 / 防火墙规则

| 端口 | 来源 | 用途 |
|---|---|---|
| 22 | **仅本机公网 IP `/32`** | SSH；全网开放不建议 |
| 80 | `0.0.0.0/0` | HTTP（域名形态，用于跳转 HTTPS 与证书校验） |
| 443 | `0.0.0.0/0` | HTTPS（PWA 安装必需） |
| 8080 | `0.0.0.0/0` | 仅**无域名**的临时演示形态 |

> 对照：华为云那版只开了 22 + 8080，所以访问地址是 `http://<EIP>:8080`。上线到域名就必须开 80/443。

---

## 四、上线前必改的 4 处

1. **端口与 443**：`docker-compose.yml` 现在是 `8080:80`，改成 `80:80` + `443:443`，并在 `deploy/nginx.conf` 增加 443 `server` 块挂载证书。PWA（`sw.js` / `manifest.webmanifest`）**只有 HTTPS 才能安装**。
2. **CORS 收紧**：`deploy/env.example` 里 `LINGUADE_CORS_ORIGINS=*` → 改成实际域名，如 `https://linguade.example.com`。
3. **SQLite 持久化**：`LINGUADE_DATABASE_URL=sqlite+aiosqlite:///./linguade.db` 落在容器内，`docker compose down` 或重新构建就清空。加 volume：
   ```yaml
   backend:
     volumes:
       - ./data:/app/backend      # linguade.db 落宿主目录
   ```
   多端同步场景直接换云数据库 PostgreSQL：`LINGUADE_DATABASE_URL=postgresql+asyncpg://user:pass@<host>:5432/linguade`（驱动 `asyncpg` 已在 `backend/requirements.txt`）。
4. **SSE 流式**：`deploy/nginx.conf` 已配 `proxy_buffering off` / `proxy_cache off` / `proxy_read_timeout 120s`。若前面再加 CDN 或 负载均衡（SLB/CLB），需同样**关闭响应缓冲 + 读超时 ≥ 120s**，否则流式对话会整段卡住才返回。

---

## 五、云上 AI 能力对接（全部可选）

后端只认 OpenAI 兼容协议（`backend/app/llm.py`、`config.py`），留空则 `/api/health` 的 `llm/asr/ocr` 为 `false`，前端自动降级到直连或本地规则。

| 能力 | 环境变量 | 阿里云 | 腾讯云 |
|---|---|---|---|
| 对话 / 批改（LLM、视觉 OCR） | `LINGUADE_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | 百炼 DashScope：`https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen-plus` / `qwen-turbo` | TokenHub / 混元，或腾讯托管 DeepSeek 的 OpenAI 兼容端点 |
| 语音转写（Whisper 通道） | `LINGUADE_ASR_BASE_URL` | 自建 Paraformer / Whisper 推理服务（ECS GPU 或 函数计算） | 实时语音识别 ASR，或自建 Whisper 推理 |
| 数据层 | `LINGUADE_DATABASE_URL` | RDS for PostgreSQL / PolarDB | TencentDB for PostgreSQL |
| 缓存 | `LINGUADE_REDIS_URL` | 云数据库 Redis 社区版 1 GB | 云数据库 Redis 标准版 1 GB |
| 音素评估通道 | `LINGUADE_PHONEME_CHANNEL=acoustic` + `LINGUADE_PHONEME_BASE_URL` | 需外部声学评估服务，约定 `POST {base}/assess`，body `{ref,hyp,meta}` | 同左；不配则默认 `rule`（零依赖本地实现） |
| 知识追踪通道 | `LINGUADE_KT_CHANNEL=dkt` + `LINGUADE_KT_BASE_URL` | 需深度 KT 服务，约定 `POST {base}/predict`，body `{skill,history}` | 同左；不配则默认 `bkt` |

> 外部通道不可用时后端自动回落 `rule` / `bkt`，响应带 `source:"fallback"`，前端主流程无感。
> `--env` 注入方式属于华为云 auto-deploy 脚本，阿里云/腾讯云走 `.env` 文件。

---

## 六、阿里云操作步骤（路线 B）

```bash
# 0) 本地：确保产物最新
python tools/build.py
python tools/check.py

# 1) 控制台准备：实名认证 + 充值（按量付费需余额 ≥ 100 元，直接买包月套餐更省）
#    购买：轻量应用服务器 → 华东1(杭州) → 2C4G → Ubuntu 22.04 → 安全组放行 22(本机IP)/80/443

# 2) 装 Docker（国内务必配镜像加速，否则 build 会超时）
ssh lighthouse@<公网IP>
sudo curl -fsSL https://get.docker.com | sh
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "registry-mirrors": ["https://<你的阿里云加速前缀>.mirror.aliyuncs.com"] }
EOF
sudo systemctl restart docker

# 3) 上传代码（沿用原部署路径）
scp -r linguade lighthouse@<公网IP>:/opt/auto-deploy/linguade

# 4) 启动
ssh lighthouse@<公网IP>
cd /opt/auto-deploy/linguade
cp deploy/env.example .env      # 填 LLM 地址与 Key，收紧 CORS
sudo docker compose up -d --build

# 5) 验证
curl -s http://127.0.0.1/api/health        # ok:true，查看 llm/asr/phoneme/kt 通道状态
```

浏览器打开站点 → 前端「设置 → 后端 API」填本站地址 → 对话页发一句德语，若已配大模型，顶部应显示云端驱动且逐字流式。

**域名 + HTTPS**：买域名 → **ICP 备案（约 7–20 天，阿里云备案管家免费）** → 解析到公网 IP → 申请免费 DV 证书 → nginx 挂 443 → `.env` 改 `LINGUADE_CORS_ORIGINS`。

---

## 七、腾讯云操作步骤（路线 B）

```bash
# 1) 控制台：实名认证 + 充值；或直接秒杀「轻量应用服务器 2C4G / 4M 峰值带宽」档
#    镜像选 Ubuntu 22.04；轻量可直接选 Docker 应用模板省掉装 Docker
#    防火墙放行 22(本机IP)/80/443

# 2) 若用 CVM：S5.MEDIUM4 + 50G SSD + 公网带宽，安全组同上

# 3-5) 与阿里云完全一致（同一份 docker-compose.yml）
scp -r linguade lighthouse@<公网IP>:/opt/auto-deploy/linguade
ssh lighthouse@<公网IP>
cd /opt/auto-deploy/linguade && cp deploy/env.example .env && sudo docker compose up -d --build
curl -s http://127.0.0.1/api/health
```

**域名 + HTTPS**：域名 → 备案 → 解析 → 腾讯云免费 DV 证书（TrustAsia）→ 前端加速选 **EdgeOne**（静态站点友好，免费额度够用，可直接以 COS 为源站）或 CDN。

---

## 八、路线 A 操作要点（纯静态）

**阿里云 OSS**
1. 建 Bucket（公共读）→ 基础设置 → **静态页面** → 索引文档 `index.html`；
2. 上传 `dist/` 全部内容 + `deploy/manifest.webmanifest`、`deploy/sw.js`、`deploy/icon.svg`、`deploy/icon-maskable.svg`；
3. Bucket 授权策略允许匿名 `GetObject`；
4. 可选：接 CDN/DCDN 并开 gzip/brotli。

**腾讯云 COS**
1. 建 Bucket → **静态网站**功能开启 → 索引文档 `index.html`；
2. 上传同上；
3. Bucket ACL 公有读，或用语义更小的访问策略；
4. 可选：接 CDN / EdgeOne。

> ⚠️ **强制下载坑**：两家在**中国内地地域**用存储默认域名直接访问 HTML，常因合规策略返回 `Content-Disposition: attachment` 而被浏览器下载而非渲染（需在你账号开通后实测确认）。解法二选一：
> - 绑定**已 ICP 备案**的自定义域名或走 CDN；
> - 把 Bucket 放在**境外地域**（新加坡 / 东京），无需备案但境内访问延迟上升。

路线 A 下系统 20 个模块、算法沙盘、离线规则引擎**全部可用**；仅云端语音转写、拍照批改后端通道、多端同步需要 B/C 路线。

---

## 九、备案与成本提醒

- 仅用 **公网 IP:80 / :8080** 访问 → **不需要备案**，当天可上线（原华为云方案即此思路）。
- **域名 + 内地节点 + 80/443** → 必须 ICP 备案（约 1–3 周）；HTTPS 与 PWA 安装都依赖域名。
- 用完及时**退订 / 释放**：ECS/CVM 按量 + 公网带宽会持续计费；两家均可设到期自动释放，建议演示期用按量、结束后立即销毁。
- 上次华为云部署失败的直接原因是 **账户余额不足（`Ecs.7000`）+ AK/SK 签名 401（`APIGW.0301`）**，属账号与凭证问题，与架构无关 —— 换云后第一件事是确认余额和 AccessKey 有效。

---

## 十、故障排查速查

| 现象 | 处理 |
|---|---|
| 页面能开、AI 不可用 | 查 `/api/health` 的 `llm`/`asr` 是否为 `true`；确认前端「设置 → 后端 API」已填 |
| 对话不流式、整段返回 | 中间链路开了缓冲：nginx / CDN / 负载均衡统一 `proxy_buffering off` |
| `docker compose build` 超时 | 配置镜像加速器（第六节第 2 步），或预拉 `python:3.12-slim`、`nginx:alpine` |
| 重新部署后学习数据消失 | 第四节第 3 条 volume 未挂，或已切 PostgreSQL 但连接串不对 |
| 上传的 HTML 变成下载 | 第八节的默认域名强制下载策略，绑已备案域名或改境外地域 |
| PWA 不提示安装 | 非 HTTPS，或 `sw.js`/`manifest.webmanifest` 未随站点部署到根路径 |
| 502（`/api`） | 前端容器找不到 `backend`：确认两个服务在同一 compose 网络，且 `nginx.conf` 的 `proxy_pass http://backend:8000` 未改 |

---

## 十一、验收清单

- [ ] `curl http://<地址>/api/health` 返回 `"ok": true`
- [ ] 首页 20 个模块可进，入学诊断 10 题可完成
- [ ] `.env` 已填且**未提交**仓库；`LINGUADE_CORS_ORIGINS` 已收紧
- [ ] SQLite 数据卷已挂载并完成一次重启验证（`docker compose restart backend` 后进度仍在）
- [ ] HTTPS 证书有效，PWA 可安装、可离线打开
- [ ] 安全组 22 端口仅放行控制机 IP
- [ ] 已记录销毁/退订路径，演示结束即释放
