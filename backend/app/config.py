"""LinguaDE 后端配置
通过环境变量切换华为云资源：
  DATABASE_URL = postgresql+asyncpg://user:pass@rds-host:5432/linguade   # 华为云 RDS
  REDIS_URL    = redis://:pass@redis-host:6379/0                        # 华为云 Redis
  LLM_BASE_URL / LLM_API_KEY / LLM_MODEL                               # 大模型（OpenAI 兼容，含华为云 MaaS）
  ASR_BASE_URL = http://<昇腾推理服务>/v1/asr                           # Whisper 推理服务
  ASR_API_KEY                                                            # 自建服务的可选访问 Key
  OCR_BASE_URL / OCR_PROJECT_ID / OCR_AK / OCR_SK                       # 华为云 OCR（可选）
  TTS_CHANNEL = off / siliconflow / hwcloud                             # 发音合成（可选）
  SILICONFLOW_API_KEY / SILICONFLOW_TTS_MODEL / SILICONFLOW_TTS_VOICE   # 语言 API Key 通道（德语可用）
  TTS_SIS_ENDPOINT / TTS_SIS_PROPERTY                                   # 华为云 SIS（AK/SK 复用 OCR 的）
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "LinguaDE API"
    # 数据层：默认本地 SQLite，生产切换 RDS for PostgreSQL
    database_url: str = "sqlite+aiosqlite:///./linguade.db"
    # 缓存层：默认关闭，配置后走华为云 Redis
    redis_url: str = ""
    # 大模型
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    # 接口类型：openai（Bearer，自动补 /chat/completions）/ azure（api-key + deployment + api-version）/ custom（完整地址原样请求）
    llm_api_style: str = "openai"
    llm_api_version: str = "2024-02-15-preview"
    # 语音：自建 Whisper 推理服务（德语唯一可用通道）；访问 Key 可选
    asr_base_url: str = ""
    asr_api_key: str = ""
    # 华为云 OCR（手写识别，可选前置通道）：AK/SK + Project ID + 区域 Endpoint
    ocr_base_url: str = ""
    ocr_project_id: str = ""
    ocr_ak: str = ""
    ocr_sk: str = ""
    # TTS 发音合成（可选通道）：off（默认，前端回落浏览器 TTS）/ siliconflow（语言 API Key，
    # 德语可用）/ hwcloud（SIS RunTts，复用 OCR 的账号级 AK/SK，官方音色表仅中英文）/
    # voxcpm（自建 vLLM-Omni / Nano-vLLM 的 OpenBMB VoxCPM2，零商业凭据；失败走 501）
    tts_channel: str = "off"
    siliconflow_base_url: str = "https://api.siliconflow.cn"
    siliconflow_api_key: str = ""
    siliconflow_tts_model: str = "heygen/heygen-voice-1-turbo"   # 免费至 2026-11-30，失效自动降级
    siliconflow_tts_voice: str = ""                              # HeyGen UUID voice_id；留空走 CosyVoice2
    tts_sis_endpoint: str = ""                                   # 如 https://sis-ext.cn-north-4.myhuaweicloud.com
    tts_sis_property: str = "chinese_xiaoyu_common"
    voxcpm_base_url: str = ""                                    # 如 http://127.0.0.1:8000（vllm serve --omni）
    voxcpm_api_key: str = ""                                     # 本地自建默认空；有鉴权网关才填
    voxcpm_model: str = "openbmb/VoxCPM2"
    voxcpm_voice: str = ""                                       # 留空走服务端默认音色
    # 音素评估通道（3.7.0 可选通道）：rule（默认，零依赖规则式 G2P）/ acoustic（外部声学服务）/ off
    phoneme_channel: str = "rule"
    phoneme_base_url: str = ""
    phoneme_timeout: int = 20
    # 知识追踪通道：bkt（默认，与前端 engine.js 同口径）/ dkt（外部深度模型服务）/ off
    kt_channel: str = "bkt"
    kt_base_url: str = ""
    kt_timeout: int = 20
    # 跨域
    cors_origins: str = "*"
    # 账号体系：邀请码为空则关闭注册；admin_user 指定的用户名注册后自动成为管理员
    invite_code: str = ""
    admin_user: str = ""
    session_days: int = 7
    # HTTPS 部署时置 1：会话 Cookie 带 Secure，浏览器不会在明文 HTTP 上发送
    cookie_secure: bool = False
    # AI 配额：按账号滚动 24 小时 / 每分钟；单进程内存计数
    ai_daily_limit: int = 200
    ai_minute_limit: int = 12

    class Config:
        env_file = ".env"
        env_prefix = "LINGUADE_"


settings = Settings()
