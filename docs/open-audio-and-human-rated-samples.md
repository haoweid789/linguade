# 开放德语听力与人工评分样本调研

调研日期：2026-10-29

## 结论

- **新闻原声**：没有找到可以确认允许下载、裁剪并重新打包进 LinguaDE 的 Deutschlandfunk/DW 新闻录音授权。Deutschlandfunk 明确要求音频的复制、剪辑、存储、重新发布或传播事先取得书面同意；适合在产品中放“去官网收听”的链接，不适合把 MP3 抓下来随软件分发。
- **新闻类开放语音替代**：Meta 的 VoxPopuli 提供德语欧洲议会发言及转写，German ASR 部分标示 CC0；但原始音频仍受欧洲议会法律声明约束，具体素材要检查权利标记和下载限制。它是时政/议会演讲，不是新闻播报。它是大语料（德语标注约 282 小时），不适合整体打包；适合日后按授权审查后做外部语料导入。
- **开放真人德语语音**：Mozilla Common Voice 的部分数据标为 CC0，但 Data Collective 的具体数据页禁止重新托管或分享数据集。CC0 不会覆盖平台另行约定的再托管限制，因此本产品不打包该语料。
- **人工评分写作样本**：MERLIN 共 2,286 篇德语、意大利语、捷克语学习者文本，其中德语 1,033 篇；训练过的评阅者按分析量表重新评分，并用统计方法校正评阅宽严差异。官方完整数据提供整体 CEFR 评级及语法准确度、词汇、衔接、拼写等维度，CC BY-SA 4.0，可下载；本次接入的 1,033 条德语源记录只保留单一整体 CEFR 人工评级，不包含完整维度。清除直接标识信息并跳过一条清理后为空的文本后，数据库收录 1,032 条。产品副本会剔除信件抬头中的住址、邮箱、电话号码和落款姓名，保留样本 ID 与来源。该语料不是 TestDaF 专项评分样本。打包的改编内容按 CC BY-SA 4.0 署名并继续采用相同许可。
- **TestDaF 专项**：DISKO 的核心子语料确实来自 TestDaF 写作题，由 TestDaF 专业评分者评分；但访问受限，需要学术账号/CLARIN AAI 身份或向语料维护者申请。DISKO_WebTestDaF 的 479 篇数字 TestDaF 田野测试文本没有逐篇人工评分，只有作者的 onSET 能力分类，因此不能把它们当作逐篇评分金标准。

## 对当前产品的建议

1. 保留现有 Tatoeba 内容管线与授权校验；原有 300 句包中有 2 条带 CC BY 4.0 真人录音。本次语料库按录音逐条核验许可并保留署名与来源 URL，不能只看句子文本许可。
2. 已新增独立 SQLite 内容库和 FastAPI 只读接口；逐条保留来源 URL、原始作品 ID、音频许可、署名与文本转写，不把数据库内嵌进单文件离线版。
3. 听力模块添加 Nachrichtenleicht 官网收听入口；要下载/缓存/剪辑 Deutschlandfunk 音频需先取得书面许可。
4. 写作评分先用 MERLIN 做“CEFR 写作表现案例库”和评分解释参考，不直接把 MERLIN 的 CEFR 等级映射成 TestDaF 分数。若需要校准 TestDaF 分数，向 DISKO/语料作者申请经许可的样本和评分维度数据。
5. 评分报告中持续注明自动评分是学习反馈，不等同官方考试评分；数据集的人工作品标签只用于评估/校准，需保留语料 ID，避免重识别作者。

## 官方来源

- MERLIN 语料说明、德语 1,033 篇、人工复评维度与统计校正：<https://www.merlin-platform.eu/C_mcorpus.php>
- MERLIN 语料下载与 CC BY-SA 4.0：<https://www.merlin-platform.eu/>
- MERLIN 下载页：<https://www.merlin-platform.eu/C_data.php>
- DISKO 说明、TestDaF 专业阅卷背景、数字 TestDaF 子集无逐篇评分及受限访问：<https://home.uni-leipzig.de/sprastu/en/corpora/DISKO_en/>
- VoxPopuli 数据说明、德语语料规模与 CC0/原始音频声明：<https://github.com/facebookresearch/voxpopuli>
- Mozilla Common Voice 使用条款（CC0）：<https://commonvoice.mozilla.org/oc/terms>
- Mozilla Data Collective 关于不得转存/再分享数据集的说明：<https://community.mozilladatacollective.com/faq-why-cant-i-re-host-or-share-common-voice-datasets-that-i-download-from-mdc/>
- Tatoeba 逐条音频许可、署名与下载路径说明：<https://en.www.en.wiki.tatoeba.org/articles/show/faq>
- Nachrichtenleicht 官网及官方收听说明：<https://www.nachrichtenleicht.de/> · <https://www.nachrichtenleicht.de/benutzung-100.html>
- Deutschlandfunk 官方使用条款：<https://www.deutschlandfunk.de/nutzungsbedingungen-102.html>
- 欧洲议会官方法律声明：<https://www.europarl.europa.eu/legal-notice/en/home>



