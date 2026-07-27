# Changelog

本项目的重要版本变化记录在此文件中。

## [0.2.0] - 2026-07-27

### Added

- 88 张鸟图与 12 张非鸟图分库评测，以及 `subject_type`、`scene` 人工真值字段。
- Region+captive 候选集合并、候选覆盖门禁和稳定 labels hash。
- 安全非鸟拒识、阈值校准、检测证据与 pipeline fingerprint。
- EXIF 时间与 BioCLIP embedding 连拍分组、融合 Top5 和显式整组确认。
- 物种资产、分层准确率、自动通过精度/覆盖率、拒识、检测、耗时和连拍指标。
- 本地 API 契约文档与可配置 Playwright 端到端测试。

### Changed

- 应用容器改用官方多架构 Node 基础镜像。
- AI 容器补齐 OpenCV/YOLO 所需运行库。
- `sample-photos/` 仅保留仓库原有少量示例图；本地 88+12 真值集、SQLite、模型、区域标签和评测产物不进入 Git。

### Security

- `.env`、本地数据库、模型、评测产物、拒识图库、编辑器目录和新增本地照片均被忽略。
- 发布提交不包含本机绝对路径、真实密钥、访问令牌或本地图库元数据。

## [0.1.6] - 2026-07-26

- 完善全量标签生成、ROI 检测裁剪、可选多模态兜底和 Docker 使用说明。
