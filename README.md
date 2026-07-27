# 灵羽图库 (Bird MVP) v0.2.0

这是一个本地运行的 Web 应用：前端用于快速浏览/筛选/打标，后端负责扫描目录、生成缩略图缓存、SQLite 持久化；并通过一个本地 AI 服务进行鸟种识别（BioCLIP2）。

## v0.2.0：可信识别与物种资产闭环

- 人工真值：物种确认与 `bird/non_bird/unknown`、`wild/captive/unknown` 正交记录
- 可量化评测：总体/野生/圈养 Top1、Top5，非鸟拒识、自动通过精度/覆盖率、检测召回、耗时和连拍融合
- Pipeline 追溯：新识别结果记录候选集 hash、模型、prompt、检测与融合配置 fingerprint
- 区域候选集：`data/models/regions/<REGION>.csv ∪ data/models/captive.csv`，按科学学名去重
- 安全拒识：无鸟框只能降低可信度；非鸟阈值默认禁用，必须经 88+12 真值集校准
- 连拍融合：按 EXIF 时间和 BioCLIP embedding 分组，保存独立融合 Top5，并支持显式确认整组
- 媒体资产：按物种聚合预测数、人工确认数和代表照片
- EXIF GPS：新扫描或回填时会保存合法的经纬度

## 一句话启动及使用

```bash
# 1. 启动服务（首次需构建）
docker compose up --build -d

# 2. 生成全球全量鸟种标签（推荐，大幅提高识别率；已生成可跳过）
npm run labels:world && docker compose restart ai

# 3. 浏览器访问：http://localhost:3001
# 4. 在页面添加库路径 /photos 并扫描 -> 识别（如需覆盖重跑，点“重识别”）
# 5. 如需清除识别结果：支持单张清除（详情页垃圾桶）与按库一键清除（顶部“清除识别”）
```

### 建立区域候选集

```bash
# 例：生成江苏区域候选集，需要 EBIRD_API_KEY
npm run labels:region -- CN-JS
docker compose restart ai
```

在页面“物种资产”区域把图库候选区域设为 `CN-JS`。AI 会将区域 CSV 与仓库内
`data/models/captive.csv` 合并，结果的 `labelSet` 记录为 `CN-JS+captive`。区域文件或
`captive.csv` 缺失时会明确报错，不会静默退回全球集；需要全球基线时把区域设为 `WORLD`。

### 建立人工真值并评测

在照片详情中先选择 `wild/captive/unknown`，再确认 Top5、标记“候选均不对”“非鸟”或
“无法判断”。`sample-photos/` 是 88 张鸟类主集，`rejection-photos/` 是独立的 12 张拒识集；
Docker 内路径分别为 `/photos` 和 `/rejection-photos`。随后可在页面刷新评测，或运行：

```bash
npm run eval -- data/cache/catalog.sqlite
npm run eval:nonbird-threshold -- data/cache/catalog.sqlite
# 区域+captive 必须覆盖全部已确认物种，否则退出码为 2
npm run labels:check -- data/cache/catalog.sqlite data/models/regions/CN-JS.csv
```

第二条命令只有在非鸟自动拒识精度达到 95% 且鸟类误拒不超过 1 张时才输出可启用阈值，
否则保持 `NON_BIRD_MAX_SCORE=0`。准确率为空表示还没有相应人工真值，不会用模型置信度冒充准确率。
自动通过精度与覆盖率只以“已确认科学学名的鸟图”为评测分母；`bird/status=unknown` 不会被
当成自动通过错误。同时报告 `allInputAccepted/allInputCoverage`，用于观察所有输入上的实际
自动决策量，避免可信精度口径掩盖人工复核工作量。

固定实验顺序为：

| 组别 | 图库区域 | 检测 | Prompt |
|---|---|---|---|
| A | `WORLD` | `DETECT_ENABLED=0` | `single` |
| B | `WORLD` | `DETECT_ENABLED=1`、1280、Top-N=3 | `single` |
| C | `CN`/拍摄区域 | 同 B | `single` |
| D | `CN`/拍摄区域 | 同 B | `scientific-4` |

每次只改一项，覆盖重识别后运行同一条 `npm run eval`。D 组只用于缓存完成后的实验，
当前默认仍是 `single`。


## Docker 部署（推荐）

### 1) 配置镜像源（Docker Desktop）

使用开源镜像站搜索镜像：https://docker.aityp.com/
应用镜像使用 Docker Hub 官方多架构 Node 基础镜像，arm64/amd64 均可构建；国内网络可在
Docker Desktop 中配置镜像加速。AI 的 CUDA 镜像仍面向 Linux GPU/amd64 运行环境。

### 2) 启动

在项目根目录：

```bash
docker compose up --build -d
```

打开：`http://localhost:3001/`

### 可选：用 make 简化常用命令

如果你本机有 GNU Make（例如 macOS/Linux，或 Windows 的 Git Bash/MSYS2），可以直接：

```bash
make help
make up
make logs
make ai-health
make data-clean
```

### 3) 添加你的照片目录

容器内默认挂载 `./sample-photos` 到 `/photos`，并挂载 `./rejection-photos` 到
`/rejection-photos`。请建立两个图库，分别用于鸟种准确率和非鸟拒识评测。
仓库内的 `sample-photos` 默认只保留少量示例图片。

如果要换成你自己的目录，请修改 `docker-compose.yml` 的 `app.volumes`，把宿主机目录挂载到容器（示例）：

```yaml
volumes:
  - D:/BirdJpg:/photos:ro
```

然后在页面新增库路径填：`/photos`。

## 鸟种识别（BioCLIP2）

默认内置了少量常见鸟示例标签，用于验证链路。你可以通过 `BIRD_LABELS_PATH` 提供一个 CSV，格式为：

```csv
中文名,学名
麻雀,Passer montanus
喜鹊,Pica pica
```

将该 CSV 挂载进 `ai` 容器并设置环境变量即可。

### 识别方式（输入与裁剪）

识别时并不是直接把原图丢给 AI，而是由后端先生成“识别专用图片”，再调用 AI 服务：

- 输入图片：从原图生成 JPEG（默认最大边 4096、质量 90），用于尽量保留细节
- 多裁剪（单张识别默认开启）：全图 + 多个方形裁剪分别识别，再把结果融合（同一物种取各次识别中的最高分）
- 批量识别：默认只跑全图（更快）；可通过环境变量开启多裁剪

识别入口：
- 单张识别：详情页点击“识别”
- 批量识别：库顶部点击“一键识别”（覆盖重跑用“重识别”）

### 识别输入调优（可选）

识别输入调优支持两种方式：
- 推荐：页面顶部“调优”面板修改（保存到本地 SQLite，立即生效）
- 环境变量：设置在 `app` 服务（Docker 在 `docker-compose.yml`；本地开发写入 `.env`）

- `IDENTIFY_MAX_SIZE`：识别输入最大边（默认 `4096`，范围 512–8192）
- `IDENTIFY_JPEG_QUALITY`：识别输入 JPEG 质量（默认 `90`，范围 30–100）
- `IDENTIFY_CROPS_SINGLE`：单张识别裁剪次数（默认 `9`，范围 1–9）
- `IDENTIFY_CROPS_BATCH`：批量识别裁剪次数（默认 `3`，范围 1–9）
- `IDENTIFY_CROP_SCALES_SINGLE` / `IDENTIFY_CROP_SCALES_BATCH`：多尺度裁剪（逗号分隔，范围 0.35–0.9；例如 `0.6,0.45`）

Docker 示例（修改 `docker-compose.yml` 的 `app.environment`）：

```yaml
environment:
  - IDENTIFY_MAX_SIZE=4096
  - IDENTIFY_JPEG_QUALITY=90
  - IDENTIFY_CROPS_SINGLE=9
  - IDENTIFY_CROPS_BATCH=3
  - IDENTIFY_CROP_SCALES_SINGLE=0.6,0.45
  - IDENTIFY_CROP_SCALES_BATCH=0.6,0.45
```

识别率不理想时的排查顺序：

- 先看 AI 候选集是否正确：打开 `http://localhost:3001/api/ai/health`，确认 `labels` 数量与预期一致
- 再看图片是否“小鸟占比太低”：优先用单张识别（默认多裁剪）验证效果；必要时提高 `IDENTIFY_CROPS_SINGLE` 或调大 `IDENTIFY_CROP_SCALE`
- 仍不理想：增大 `IDENTIFY_MAX_SIZE`（例如 6144）或提高 `IDENTIFY_JPEG_QUALITY`（例如 95）

### 低置信度兜底（可选：多模态大模型）

当离线模型识别“置信度不高”（Top1 分数低或 Top1-Top2 间隔小）时，后端可选地调用多模态大模型对“候选 TopK”做一次兜底判断，并把结果展示在详情页的“兜底”区域。

说明：
- 兜底只会在离线模型给出的候选 TopK 里做选择，避免大模型乱猜
- 开启后会产生联网请求与费用
- 推荐用页面顶部“调优”面板启用并填写 Key（Key 存本地 SQLite，不会回显也不会写回 `.env`）

用环境变量配置（参考 `.env.example`）：

```bash
# Qwen (DashScope OpenAI 兼容模式；模型需支持图片输入，通常为 *vl* 系列)
QWEN_API_KEY=你的 key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_NAME=qwen-vl-plus

# 可选：触发阈值（默认与前端提示一致）
LLM_FALLBACK_TRIGGER_SCORE=0.6
LLM_FALLBACK_TRIGGER_MARGIN=0.1
```

### 获取“全量中国鸟种”CSV（推荐：eBird API 自动生成）

项目内置了一个脚本，使用 eBird API 拉取「中国（CN）区域曾记录的物种代码」+「eBird taxonomy（支持中文 locale）」并生成 `data/models/labels.csv`。

说明：eBird API 大多数接口需要 API Key，并通过请求头 `x-ebirdapitoken` 传入。参考 eBird 官方 API 文档：https://documenter.getpostman.com/view/664302/S1ENwy59

1) 生成 eBird API Key（登录 eBird 后在 Keygen 页面生成）

2) 在项目根目录运行（PowerShell）：

```powershell
$env:EBIRD_API_KEY = "你的 key"
npm run labels:cn
```
或者直接在.env添加key：

```bash
EBIRD_API_KEY=你的 key
```

成功后会生成：`data/models/labels.csv`（容器内对应 `/models/labels.csv`），重启 AI 容器即可生效：

```bash
docker compose up -d --force-recreate ai
```

说明：默认不再把 AI 服务端口暴露到宿主机（避免 Windows 端口占用/权限问题）；应用容器通过 `http://ai:8000` 在 Docker 网络内访问即可。

### 无 GPU / 强制 CPU

默认 `docker compose up` 不请求 GPU，可直接在 Mac 或无 NVIDIA GPU 的机器上使用 CPU。

有 NVIDIA Container Toolkit 时，通过覆盖文件启用 GPU：

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d
```

如需即使检测到 GPU 也强制 CPU，可设置 `FORCE_CPU=1`。

### 识别报错 fetch failed / AI 不可用

优先打开后端探测接口查看更具体的原因：

- `http://localhost:3001/api/ai/health`

常见原因：
- `BIRD_AI_URL` 配置不正确：容器内通常是 `http://ai:8000`；宿主机本地运行则应使用可访问的地址（例如 `http://localhost:8000`）
- `ai` 容器未启动或启动失败：尤其是在没有 NVIDIA GPU 的环境中，需按上面的“强制 CPU”处理
- `ai` 容器刚启动/重启：模型在加载期会短暂返回 `loading`，等几十秒后再重试即可

### ROI 目标检测裁剪（默认开启，提升识别率）

为提升“小鸟占比低/主体不居中”的识别率，`ai` 服务内置了目标检测（YOLO）来自动找鸟并裁剪后再做 BioCLIP 识别；若检测不到，也会对全图做少量方形裁剪兜底。

默认行为：
- 后端默认只发送 1 张全图给 `ai`（更快）
- `ai` 服务在内部做检测与多裁剪融合（更像 superpicky 的效果）

可选环境变量（配置在 `ai` 服务）：
- `DETECT_ENABLED`：是否启用检测（默认 `1`）
- `DETECT_MODEL`：检测模型（默认 `yolov8n.pt`）
- `DETECT_CONF`：检测阈值（默认 `0.25`）
- `DETECT_CLASS_ID`：检测类别（默认 `14`，COCO 的 bird）
- `DETECT_IMGSZ`：首轮检测基线为 `1280`
- `DETECT_TOP_BOXES`：首轮检测基线为 `3`
- `DETECT_MAX_CROPS`：检测到目标后最多跑几张裁剪（默认 `3`）
- `DETECT_FALLBACK_CROPS`：检测不到时是否做兜底裁剪（默认 `1`）
- `DETECT_FALLBACK_MAX`：兜底裁剪最多跑几张（默认 `4`）

建议先打开健康检查确认检测是否启用与是否报错：
- `http://localhost:3001/api/ai/health`（会返回 detectEnabled/detectError）

检测到鸟时才允许按物种阈值自动通过；未检测到鸟且分数较高时进入待复核。未检测到鸟且
分数低时也只有在 `NON_BIRD_MAX_SCORE` 经真值集校准并显式启用后才自动拒识。

### 识别非中国鸟类（例如金刚鹦鹉）：生成“全球鸟种”CSV

常见圈养/展出鸟应维护在 `data/models/captive.csv`，正常主路径使用区域集与该文件的并集。
全球集只用于 A/B 基线或未来显式的全球重识别，不作为区域文件缺失时的 fallback。

可以用脚本生成全量 eBird taxonomy（全球物种）作为候选集：

```powershell
npm run labels:world
```

然后在页面里点击“重识别”（覆盖重跑），让已有照片按新标签集重新识别。

可选参数：
- `--region`：默认 `CN`（中国）；也可以用 eBird 的其它 regionCode
- `--locale`：默认 `zh_CN`（中文）

脚本位置：`scripts/ebird_labels.mjs`

## 本地开发（非 Docker）

```bash
npm install
npm run dev
```

环境变量建议使用 `.env`（参考 `.env.example`），不要把真实 key 提交到仓库。

前端：`http://localhost:5173/`（代理到后端）
后端：`http://localhost:3001/`

### 数据与迁移（重要）

- SQLite 存储位置：由 `CACHE_DIR` 决定，默认是 `data/cache`（库文件为 `catalog.sqlite`）
- 数据库 schema 通过 migrations 管理：启动时自动执行 `server/migrations/*.sql`（或 `MIGRATIONS_DIR` 指定目录），并记录到 `schema_migrations` 表
- 批量识别任务状态已持久化到 SQLite 的 `jobs` 表（用于轮询与取消）
- 任务并发：用 `JOB_CONCURRENCY` 控制同时运行的任务数（默认 1，建议保持 1 避免把 IO/AI 打满）
- 生成数据不进仓库：`data/cache`、`data/models` 等为运行产物/模型与标签缓存，默认已加入 `.gitignore`

### 代码组织（后端）

后端约定为：

- `server/routes`：只做 HTTP 适配（解析参数/返回响应），不要写 SQL/文件系统/AI 调用细节
- `server/services`：业务编排（“扫描库”“识别单张/批量”等）
- `server/repos`：SQL 与数据访问
- `server/lib`：基础设施与通用工具（AI client、缩略图、migrations、校验/错误等）

## 更新记录

### v0.2.0

- 建立 88 张鸟图与 12 张非鸟图的独立可信评测口径，支持 `bird/non_bird/unknown` 和 `wild/captive/unknown` 人工真值。
- 新增安全拒识、Region+captive 候选集合并与覆盖门禁；无检测框不再直接等同非鸟。
- 新增连拍分组、Top5 加权融合、代表照片选择和显式整组确认。
- 新增总体、wild、captive、拒识、自动通过、检测、耗时与连拍指标，并记录 pipeline fingerprint。
- 完善物种资产面板、EXIF GPS、Docker 多架构应用构建和浏览器端到端回归。
- 新增 [本地 API 契约](docs/API.md)，说明真值、评测、候选区域和连拍接口。

### v0.1.5

- 右侧详情面板增强：结构化文件信息 + EXIF（相机/镜头/焦距/光圈/快门/ISO 等）
- EXIF 提取与缓存：点开照片自动回填，失败会在顶部错误条提示原因
- 美学分批量回填与实时刷新：解决“只有第一张有分”的体验问题
- 扫描去重修复：按路径/指纹合并并清理重复记录，避免列表出现重复照片
- 鸟种识别增强：AI 服务增加 ROI 目标检测裁剪与兜底多裁剪，提高识别率

### v0.1.4

- 增加低置信度兜底配置与调优面板
- 修复兜底 Key 优先级与失败原因展示
- 修复单张清除后立即识别的竞态问题

### v0.1.3

- 识别输入升级：从原图生成识别专用 JPEG（默认 4096px / Q90），提升细节保留
- 多裁剪识别：单张识别默认开启“全图 + 多位置裁剪”并融合结果，提高小目标命中率
- 新增识别输入参数：支持通过环境变量调节输入尺寸、质量与裁剪策略
- 后端架构调整：routes/services/repos 分层，SQLite schema 引入 migrations，批量识别任务状态持久化并支持并发控制
