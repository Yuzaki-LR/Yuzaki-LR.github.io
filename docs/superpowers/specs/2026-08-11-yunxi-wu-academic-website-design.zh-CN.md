# Yunxi Wu 学术个人网站——设计规格（中文版）

日期：2026-08-11

状态：设计已确认，等待中文版规格复核

公开语言：英文

计划托管平台：GitHub Pages

> 本文件是英文设计规格的完整中文审阅版。实际网站仍以英文为主；涉及网站公开文案、论文题目和状态标签时，以本文件中保留的英文原文为准。

## 1. 网站目的

为 Yunxi Wu 建立一个学术个人网站，同时服务两个相互关联的目标：

1. 建立一个可以随着未来研究、项目和论文持续扩展的长期学术档案；
2. 服务硕士和博士项目申请，让招生老师和潜在导师能够快速核实研究方向、工程成果、个人贡献和联系方式。

网站整体应呈现为学术主页，而不是视觉设计作品集。网站不得暗示尚未完成的具身智能、计算机视觉或机器人相关工作已经形成了完整研究成果。

## 2. 目标读者

主要读者包括：

- 硕士和博士项目的招生老师；
- 潜在导师与科研合作者；
- 了解 Yunxi Wu 学术和工程背景的研究人员与工程师；
- 研究导向工程岗位的招聘人员。

网站内容层级面向三种浏览深度：

- 大约 10 秒：确认姓名、学位、学校和研究兴趣；
- 大约 60 秒：查看具有代表性的 EEE 项目证据和投稿论文状态；
- 深入阅读：进入项目详情页，查看个人贡献、技术证据和 CV。

## 3. 已核实的公开身份信息

第一版只能使用以下已经确认的信息：

- 公开姓名：**Yunxi Wu**
- 学位：**BEng Electronic and Electrical Engineering**
- 学校：**University of Birmingham**
- 研究兴趣：**Embodied AI、Computer Vision、Robotics**
- 当前阶段：本科生
- 网站语言：英文

已经确认的英文首页简介为：

> I am a BEng Electronic and Electrical Engineering student at the University of Birmingham. My current academic work spans systems design, modelling, control, and signal processing. I am developing toward research in Embodied AI, Computer Vision, and Robotics.

其中文含义为：

> 我是伯明翰大学电子与电气工程专业的 BEng 本科生。目前的学术工作涉及系统设计、建模、控制和信号处理，并正在向具身智能、计算机视觉和机器人研究方向发展。

除非用户另行提供或确认，否则不得加入毕业年份、成绩、奖学金、奖项、其他机构身份、所在城市、电子邮箱、社交账号或其他个人事实。

## 4. 设计方向

### 4.1 整体风格

采用已经确认的 **克制型学术侧栏** 方案：

- 白色背景；
- 紧凑的顶部导航；
- 宽屏时，个人资料和链接位于左侧栏；
- 主要学术内容位于右侧；
- 标题使用衬线字体，正文使用无衬线字体；
- 使用细分隔线和低饱和度蓝灰色强调色；
- 项目使用常规文字条目，不使用大型作品集卡片；
- 不使用装饰性渐变、超大展示标题、视差滚动或吸引注意力的动画。

参考网站只用于理解学术个人网站的类型。实现时不得照搬其布局、主题素材、代码或文字。

### 4.2 视觉变量

初始视觉变量如下：

- 页面背景：`#ffffff`
- 次级背景：`#f7f8f9`
- 主要文字：`#292d32`
- 次要文字：`#656c73`
- 分隔线和边框：`#dfe2e6`
- 主要强调色：`#2d587a`
- 标题字体：Georgia、`Times New Roman`、serif 回退字体
- 正文字体：Arial、`Helvetica Neue`、sans-serif 回退字体

使用系统字体，不依赖远程字体服务。悬停效果仅限链接颜色或下划线变化；键盘焦点必须清晰可见。

### 4.3 响应式布局

- 桌面和平板宽屏：约 220–240 px 的个人侧栏，加上可自适应宽度的主内容区；
- 窄屏：侧栏变为主内容上方的个人资料区域；
- 导航可以自动换行，或使用小型原生折叠菜单，不依赖 JavaScript 框架；
- 窄屏时，项目元信息移动到项目简介下方；
- 常见手机宽度下不得出现横向滚动。

## 5. 信息架构

已经确认的第一版采用聚焦型多页面结构，包含四个主要导航项目。

### 5.1 About

根页面，同时作为主要首页，包含：

1. 个人资料侧栏；
2. 简洁的学术简介；
3. 研究兴趣；
4. 三项精选项目；
5. Research & Manuscripts 条目；
6. 当前发展方向说明；
7. 仅展示已核实的公开链接。

首页不重复全部项目细节，而是为读者提供进入详情页的清晰路径。

### 5.2 Projects

Projects 总览页列出首批三个项目，并允许以后在不重新设计页面的情况下增加新项目。

每个主要项目建立独立详情页，按以下顺序组织：

1. Overview（项目概述）
2. My Contribution（我的贡献）
3. Technical Approach（技术方法）
4. Results & Validation（结果与验证）
5. Evidence Gallery（证据图集）
6. Reflection & Next Steps（反思与后续工作）

每个项目页都必须明确说明是个人项目还是团队项目。团队项目必须包含 **My Contribution**，并同时说明承担的职责和贡献边界。

### 5.3 Research

使用三个严格区分的类别：

- **Research Interests**：具身智能、计算机视觉和机器人；
- **Ongoing Work**：描述尚未完成的工作，不宣称已有结果；
- **Research & Manuscripts**：列出已投稿文稿，未来再加入经过核实的正式论文。

第一版不设置 Publications 栏目。只有当某项工作已经被接收或正式发表，并且书目信息得到核实后，才可以增加 Publications 类别。

### 5.4 CV

网页 CV 摘要按以下结构组织：

- Education
- Research Interests
- Selected Projects
- Technical Skills
- Research and Manuscripts
- Contact Links

只有在用户提供最终英文 CV PDF 后，才显示下载按钮。在此之前应隐藏下载控件，而不是提供无效链接。

## 6. 首批内容模型

### 6.1 Future Ocean Habitat — Integrated Systems Concept Design

- 类型：团队项目
- 资料来源：*Integrated Design Project 2 Assignment 1 Concept Design — Future Ocean Habitat*
- 适合公开的定位：面向自给自足未来海洋栖息地的系统概念设计
- 已核实的个人贡献：
  - Group Coordinator/Leader
  - 负责 WP3 Energy
  - 负责 WP5 Systems
  - 负责 WP6B Underwater Data Centre
  - 参与 WP1 和 WP2
- 可展示的技术主题：能源架构、系统与控制、通信和告警、水下数据中心设计与冷却

网站不得把整份团队报告描述成 Yunxi Wu 的个人成果，也不得公开组员姓名或其他成员的个人贡献信息。

### 6.2 Life-Support System — Power and Control Simulation

- 类型：个人详细设计项目
- 资料来源：个人报告和 `Life_Support_System_YunxiWu.slx`
- 适合公开的定位：未来海洋栖息地生命保障系统的多物理域电力与控制仿真
- 已核实的技术范围：
  - 180 V 直流母线；
  - 取水、反渗透、回收和分配；
  - 制氧和二氧化碳去除；
  - HVAC 和湿度控制；
  - 分层闭环控制；
  - PI 与 PWM 控制；
  - Simulink/Simscape 多物理域建模；
  - 保护、浪涌和预充电设计考虑。

项目详情页可使用以下结果，但必须保留其仿真语境：

> 在报告所记录的模型配置下，提交的仿真结果显示累计效率为 97.7%。

不得将其描述或暗示为实体系统的实测效率。

### 6.3 Communication-System Modelling and Filter Optimisation

- 类型：个人实验项目
- 资料来源：实验报告和三个 MATLAB 文件
- 适合公开的定位：噪声条件下的信道行为与相干解调建模分析
- 已核实的技术范围：
  - 带宽和温度变化下的香农容量与 BER；
  - 在 2 dB/km 衰减条件下分析 SNR 与距离的关系；
  - AWGN 下的 OOK/AM 相干解调；
  - 移动中值、FFT、Butterworth 和 Chebyshev 滤波器对比；
  - 以 BER 为主要指标，以 MSE 作为同等情况下的辅助判据；
  - MATLAB 中使用固定随机种子和参数扫描。

项目详情页可使用以下结果，但必须明确限定在报告所测试的设置和参数范围内：

> 在测试的滤波器和参数范围中，Butterworth 配置取得了报告中最低的平均 BER（0.0593）和 MSE（4.04 × 10^-2）。

### 6.4 More Electric Aircraft 综述文稿

- 所属页面：Research
- 类型：第一作者综述文稿
- 完整题目：*Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities*
- 网站必须使用的英文状态标签：**Submitted manuscript — Under editorial review**
- 中文解释：**已投稿——编辑部审核中**

不得将该文稿描述为 under peer review、accepted、in press 或 published。除非用户确认期刊和共同作者政策允许，否则不得公开提供文稿全文下载。

## 7. 准确性与隐私规则

### 7.1 可以公开的材料

- 为网站重新撰写的英文项目摘要；
- 清晰注明角色与边界的个人贡献说明；
- 已脱敏的图表、系统图和模型截图；
- 保留上下文的仿真结果；
- 经过单独隐私与质量检查后的精选代码或模型链接。

### 7.2 不得直接公开的材料

- 原始课程作业 PDF；
- 学号；
- 作业题目、任务说明和评分材料；
- 未经明确同意公开的组员姓名或个人信息；
- 暴露无关课程信息的完整报告页面；
- 未发表文稿全文；
- 虚构的联系方式、日期、指标或项目成果。

### 7.3 图片准备要求

图片必须从已核实的源材料中裁剪或重新绘制，并确保不包含学号、作业说明、无关姓名、批注或隐藏文档元数据。图片说明必须明确其属于概念图、仿真输出还是模型截图。

## 8. 等待用户提供的信息

以下资料尚未提供。网站可以先在本地完成，但不得用虚假占位链接代替缺失信息。

- GitHub 用户名：最终配置仓库前必须提供
- 公开电子邮箱：可选
- GitHub 个人资料链接：用户名确定后可添加
- LinkedIn 链接：可选
- 最终英文 CV PDF：添加下载链接前必须提供
- 个人照片：可选；未提供时使用中性的 `YW` 字母标识

## 9. 技术设计

### 9.1 网站生成方式

- 使用 Astro 生成静态网站；
- 输出预渲染 HTML；
- 第一版不使用数据库、身份验证、服务器端 API、访问分析或联系表单后台；
- 尽量减少客户端 JavaScript；
- 复用网站布局、侧栏、导航、项目条目、文稿条目和元数据组件；
- 项目与研究信息存储为具有格式校验的内容文件，以便以后新增条目时不重复编写页面布局。

建议的源文件结构：

```text
src/
  components/
  content/
    projects/
    research/
  layouts/
  pages/
    index.astro
    projects/
    research.astro
    cv.astro
  styles/
public/
  assets/
```

如果 Astro 当前支持的内容 API 需要小幅调整，可以在实施阶段优化具体文件结构，但已经确认的公开信息架构不得改变。

### 9.2 GitHub Pages 发布

- 如果可用，使用名称为 `<username>.github.io` 的仓库，以获得根用户网站地址；
- 使用 GitHub Actions 作为发布来源；
- 实施时使用 Astro 官方 GitHub Pages Action 和 GitHub Pages 部署 Action 的当前支持版本；
- 只有在 GitHub 用户名确认后，才配置网站规范网址；
- 仓库中保留锁文件，以确保构建可复现；
- 未获得用户对准确目标的明确授权前，不创建远程仓库、不推送代码，也不启用 GitHub Pages。

官方实施参考：

- <https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site>
- <https://docs.astro.build/en/guides/deploy/github/>

## 10. 无障碍、元数据与质量要求

实现时必须包含：

- 语义化页面区域和正确的标题层级；
- 可通过键盘使用的跳转到正文链接；
- 清晰可见的键盘焦点；
- 有意义图片的描述性替代文本；
- 装饰性图片使用空替代文本；
- 足够的颜色对比度；
- 每个页面独立的英文标题和描述；
- 最终主机确定后的 canonical URL；
- 正确的当前导航状态；
- 不存在无效链接或假占位链接；
- 桌面、平板和手机可用的响应式布局；
- 不公开源文档元数据或嵌入的敏感信息。

第一版不需要博客、CMS、评论、访问追踪、主题切换、中英双语、联系表单、搜索或自动生成的社交分享图。

## 11. 构建与审核流程

1. 按照已确认规格在本地完成整个网站；
2. 只提取或准备三个项目页面所必需的最少脱敏证据；
3. 验证生产构建和内部链接；
4. 根据已核实的源材料复核所有文字；
5. 检查响应式布局和无障碍要求；
6. 对所有公开素材和构建输出进行隐私检查；
7. 向用户展示本地完成版，进行事实和视觉审核；
8. 获取准确的 GitHub 用户名以及仓库与发布授权；
9. 创建或连接已批准的仓库，并启用 GitHub Pages；
10. 核实最终网址，并提供简短的网站维护说明。

## 12. 第一版验收标准

满足以下全部条件时，第一版才算完成：

- About、Projects、Research 和 CV 路由均可成功构建；
- 三个项目详情页均使用已经确认的证据模板；
- Future Ocean Habitat 的个人贡献边界明确；
- 文稿状态完全使用已经确认的表述；
- 研究兴趣和进行中的工作未被描述为已完成研究；
- 所有公开网站文字均为英文；
- 网站不含敏感课程资料或组员信息；
- 尚未提供的链接被隐藏，而不是显示为失效链接；
- 导航和内容在窄屏与宽屏下均可正常使用；
- 生产构建成功；
- 用户已经审核本地完成版；
- 只有在另行获得明确授权后才进行公开发布。

## 13. 第一版不包含的内容

- 复制参考网站或其主题；
- 公开原始课程作业或文稿全文；
- 在没有正式论文前展示完整 Publications 列表；
- 添加后台、数据库、身份验证、联系表单、访问分析或 CMS；
- 添加推测性的项目、成就、日期、指标或机构身份；
- 在英文网站完成前建立一套中文公开网站副本。
