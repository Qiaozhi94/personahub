# PersonaHub V2 页面结构与功能设计

## 1. 设计结论

PersonaHub 的工作台以 Project 为根。文件、任务、产出和知识都属于项目；Room 是围绕当前项目对象持续工作的协作面，而不是另一个首页。

```text
全局导航
└─ Project Workbench
   ├─ 项目资源管理器：定位对象
   ├─ 主预览：阅读、判断、编辑对象
   └─ Room：承载上下文、协作与派发
```

视觉与组件沿用上一版前端设计稿：浅色中性背景、细分隔线、紧凑圆角、轻量状态色、原有按钮和会话消息层级。

## 2. 页面结构思维导图

```text
PersonaHub
├─ 开始
│  ├─ 待用户处理
│  ├─ 进行中项目
│  └─ 最近完成
├─ 项目工作台（默认）
│  ├─ 项目资源管理器
│  │  ├─ 资源：真实文件、文档、外部资料
│  │  ├─ 工作：Tasks、Rooms、执行方案
│  │  ├─ 产出：Artifacts、Evidence、交付版本
│  │  └─ 知识：Decisions、Memory、Lessons
│  ├─ 主预览
│  │  ├─ 文档 / 文件
│  │  ├─ Task
│  │  ├─ Room 深度视图
│  │  ├─ Artifact
│  │  └─ Evidence
│  └─ Room 协作面
│     ├─ 当前目标与状态
│     ├─ 成员和职责
│     ├─ 会话 / 活动流
│     ├─ @指派与补充约束
│     └─ 暂停、取消、恢复、归档
├─ 能力库
│  ├─ AI Members / Squads
│  ├─ Workflows / Skills
│  └─ 跨项目 Memory
├─ 自动化
│  ├─ Scheduled Issues
│  ├─ Webhooks
│  └─ 队列与历史
└─ 设置与诊断
   ├─ Runtime / 模型认证
   ├─ Workspace 权限
   └─ 本地数据与健康状态
```

## 3. 核心对象关系

```text
Space
└─ Project
   ├─ Workspace
   ├─ Issue
   │  ├─ Primary Thread
   │  ├─ Rooms
   │  ├─ Runs / Attempts
   │  ├─ Artifacts
   │  └─ Evidence
   └─ Project Knowledge
      ├─ Decisions
      ├─ Memory
      └─ Skill Candidates
```

Room 是 Issue 某一阶段的协作与控制边界，不拥有第二套执行状态机；Run 仍是实际执行记录。

## 4. 三个核心工作面

### 4.1 项目资源管理器

项目树固定在左侧，以 Obsidian 的知识组织和 VS Code 的资源定位为参照，但统一放入真实文件与 PersonaHub 虚拟对象。四个标签只改变对象视角，不改变项目边界。

### 4.2 主预览

中间打开当前项目对象，负责完整阅读、编辑、比较和审阅。文件、Task、Artifact、Evidence 使用同一个标签页模型；复杂 Room 图谱或历史也在这里展开，而不挤压右侧会话。

### 4.3 Room

右侧沿用上一版“主会话页面”的信息结构，使会话拥有足够的阅读和编排空间。它与主预览等宽：一边看项目事实，一边推进协作。切换文件时 Room 不丢失；切换任务时才更新绑定的 Room。

## 5. 关键交互原则

1. 项目先于任务：没有游离于项目之外的任务工作台。
2. 对象与协作并列：主预览和 Room 各占可用工作区的一半。
3. 上下文保持：浏览同一任务的不同文件时，Room 保持不变。
4. 证据可追溯：Artifact 和 Evidence 能回到产生它们的 Room、Run 与原始文件。
5. 渐进披露：默认展示结果和下一步，Run ID、命令与原始事件只在诊断层出现。

## 6. 静态原型覆盖

```text
打开项目 PRD
→ 在资源树切换代码文件
→ 在工作树打开任务
→ 在右侧查看等待指派的会话
→ 在产出树打开 Artifact
→ 查看已完成 Room 的交付上下文
```

本版不表达真实编辑、拖拽分栏持久化、终端输入、实时 Agent 执行、移动端和多人同步。
