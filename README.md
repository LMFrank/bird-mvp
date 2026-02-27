# 灵羽图库 (Bird MVP) v0.1.2

这是一个本地运行的 Web 应用：前端用于快速浏览/筛选/打标，后端负责扫描目录、生成缩略图缓存、SQLite 持久化；并通过一个本地 AI 服务进行鸟种识别（BioCLIP2）。

## 一句话启动及使用

```bash
# 1. 启动服务（首次需构建）
docker compose up --build -d

# 2. 生成全球全量鸟种标签（推荐，大幅提高识别率）
npm run labels:world && docker compose restart ai

# 3. 浏览器访问：http://localhost:3001
# 4. 在页面添加库路径 /photos 并扫描 -> 识别（如需覆盖重跑，点“重识别”）
# 5. 如需清除识别结果：支持单张清除（详情页垃圾桶）与按库一键清除（顶部“清除识别”）
```


## Docker 部署（推荐）

### 1) 配置镜像源（Docker Desktop）

使用开源镜像站搜索镜像：https://docker.aityp.com/
本项目dockerfile已直接添加国内镜像源，无需额外配置。

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

容器内默认挂载了 `./sample-photos` 到 `/photos`。你可以在页面里新增库路径为：`/photos`，然后点击“扫描”。
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

如果你的 Docker 环境没有可用的 NVIDIA GPU：

1) 在 `docker-compose.yml` 的 `ai.environment` 里加：`FORCE_CPU=1`

2) 删除或注释 `ai.gpus: all`

### 识别报错 fetch failed / AI 不可用

优先打开后端探测接口查看更具体的原因：

- `http://localhost:3001/api/ai/health`

常见原因：
- `BIRD_AI_URL` 配置不正确：容器内通常是 `http://ai:8000`；宿主机本地运行则应使用可访问的地址（例如 `http://localhost:8000`）
- `ai` 容器未启动或启动失败：尤其是在没有 NVIDIA GPU 的环境中，需按上面的“强制 CPU”处理
- `ai` 容器刚启动/重启：模型在加载期会短暂返回 `loading`，等几十秒后再重试即可

### 识别非中国鸟类（例如金刚鹦鹉）：生成“全球鸟种”CSV

如果你的照片里包含明显不属于中国鸟类范围的物种（例如金刚鹦鹉），只生成中国（CN）物种标签会导致模型“只能在 CN 候选里硬猜”，结果会很不对。

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
