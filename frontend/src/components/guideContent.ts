import type { IconName } from './Icon'

export type GuideRole = 'teacher' | 'student'
export type GuideCategory = 'quickstart' | 'workflow' | 'advanced' | 'review' | 'account'

export interface GuideLink {
  label: string
  to: string
  icon?: IconName
}

export type GuideBlock =
  | { type: 'text'; text: string }
  | { type: 'steps'; title?: string; items: string[] }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'note'; title: string; text: string; tone?: 'info' | 'warning' }
  | { type: 'links'; links: GuideLink[] }

export interface GuideSection {
  id: string
  role: GuideRole | 'all'
  category: GuideCategory
  title: string
  summary: string
  keywords: string[]
  blocks: GuideBlock[]
}

export interface OnboardingSlide {
  id: 'welcome' | 'capabilities' | 'quickstart' | 'safety'
  eyebrow: string
  title: string
  description: string
  features?: { icon: IconName; title: string; text: string }[]
  steps?: { title: string; text: string }[]
  notices?: { title: string; text: string }[]
}

export interface TourStep {
  id: string
  path: string
  title: string
  description: string
  selectors: string[]
  guideAnchor: string
}

export interface ChecklistItem {
  id: string
  title: string
  description: string
  sectionId: string
}

export interface FaqItem {
  id: string
  role: GuideRole | 'all'
  question: string
  answer: string
  details?: string[]
  keywords: string[]
}

export const ONBOARDING_SLIDES: Record<GuideRole, OnboardingSlide[]> = {
  teacher: [
    {
      id: 'welcome',
      eyebrow: '老师 / 管理员入门',
      title: '把批改时间留给真正的讲解',
      description: '错题家教将试卷识别、作答判分、错题归集和 AI 答疑串在一起。一份试卷可以复用于多位学生，每份作答仍独立保存。',
      features: [
        { icon: 'book', title: '试卷只录一次', text: '识别题目与标准答案，之后反复用于不同学生。' },
        { icon: 'users', title: '学生各自归档', text: '批改、错题和统计按学生分开，不会混成一条趋势。' },
        { icon: 'pen', title: '结果可以复核', text: 'AI 给出初判，老师可修正答案、作答和判定。' },
      ],
    },
    {
      id: 'capabilities',
      eyebrow: '核心能力',
      title: '从一张试卷到长期复习',
      description: '除了自动判分，还可以处理缺答案、漏拍、识别不完整和人工改判等真实情况。',
      features: [
        { icon: 'upload', title: '灵活录入', text: '题目与答案可同传或分传，也能纯手动建卷、补题。' },
        { icon: 'sparkles', title: '讲解与答疑', text: '查看逐题解析，或围绕单题、整卷继续追问 AI。' },
        { icon: 'bookmark', title: '间隔复习', text: '错题按 1 / 3 / 7 / 16 / 30 天递进复习，记录掌握过程。' },
        { icon: 'chart', title: '统计与导出', text: '查看客观题趋势与知识点覆盖，导出筛选后的错题。' },
      ],
    },
    {
      id: 'quickstart',
      eyebrow: '三步快速开始',
      title: '先完成一份小试卷的闭环',
      description: '建议第一次用 2～3 页、字迹清楚的试卷熟悉流程，确认识别与判分符合预期后再批量使用。',
      steps: [
        { title: '建立学生档案', text: '在「学生」中添加姓名；需要学生自行上传时，再为其开通登录账号。' },
        { title: '录入并核对试卷', text: '在「试卷库」上传题目和答案，逐题检查题号、选项、标准答案与知识点。' },
        { title: '上传作答并复核', text: '回到「批改」，选学生和试卷，上传作答；完成后处理待确认题并查看讲解。' },
      ],
    },
    {
      id: 'safety',
      eyebrow: '开始之前',
      title: 'AI 会出错，敏感资料要谨慎',
      description: '识别、讲解和答疑由 AI 辅助完成，不能替代老师复核；上传内容会交由系统配置的 AI 服务处理。',
      notices: [
        { title: '看清状态再使用', text: '待确认、主观题需要人工判断；partial（部分识别）可重试，只有确认缺失影响后才接受。' },
        { title: '控制文件数量', text: '支持 PDF、JPG、PNG、WebP、HEIC；试卷一次最多 30 个文件，作答一次最多 12 个。' },
        { title: '保护学生隐私', text: '尽量裁去姓名、学号、联系方式等无关信息，不上传与教学无关的敏感资料。' },
      ],
    },
  ],
  student: [
    {
      id: 'welcome',
      eyebrow: '学生入门',
      title: '拍下作答，把每道错题弄懂',
      description: '选择老师已经准备好的试卷，上传自己的作答，就能查看判分、解析，并向 AI 家教继续提问。',
      features: [
        { icon: 'camera', title: '手机直接拍', text: '拍完检查清晰度，一次最多上传 12 个作答文件。' },
        { icon: 'sparkles', title: '不只给答案', text: '查看错因、思路和技巧，不懂的地方可以继续问。' },
        { icon: 'bookmark', title: '错题再相见', text: '按复习计划重新作答，逐步把错题变成已掌握。' },
      ],
    },
    {
      id: 'capabilities',
      eyebrow: '核心能力',
      title: '结果、答疑、复习都在一起',
      description: '你的批改记录、错题和统计彼此关联，可以从错题回到原题，也可以按知识点集中练习。',
      features: [
        { icon: 'grid', title: '逐题看结果', text: '区分答对、答错、待确认与主观题，查看题目详情。' },
        { icon: 'chat', title: '单题或整卷提问', text: '先选题再问单题；清除题目焦点后可问整卷问题。' },
        { icon: 'clock', title: '按计划复习', text: '复习间隔依次为 1 / 3 / 7 / 16 / 30 天，答错会重新进入近期复习。' },
        { icon: 'chart', title: '看见变化', text: '统计客观题趋势与知识点表现，不把待确认题当作答错。' },
      ],
    },
    {
      id: 'quickstart',
      eyebrow: '三步快速开始',
      title: '完成第一次拍照批改',
      description: '如果下拉框里没有试卷，说明老师尚未准备好，请先联系老师，不需要自己上传标准答案。',
      steps: [
        { title: '选择试卷', text: '在首页「做的哪份题？」中选择自己完成的那一份，不要选成其他试卷。' },
        { title: '上传作答', text: '拍照或从相册 / 文件选择 PDF、JPG、PNG、WebP、HEIC，确认页面齐全后提交。' },
        { title: '查看并弄懂', text: '打开批改结果，逐题看解析、向 AI 提问，再到错题本按计划复习。' },
      ],
    },
    {
      id: 'safety',
      eyebrow: '开始之前',
      title: 'AI 是助教，不是最终裁判',
      description: '模糊、涂改或超出识别能力的内容可能被标为待确认，也可能出现误判；有疑问请告诉老师复核。',
      notices: [
        { title: '不要反复提交相同作答', text: '处理期间耐心等待；弱网恢复后先刷新记录，确认状态再重试，避免重复任务。' },
        { title: '部分结果要谨慎', text: 'partial 表示有页面未成功识别，可重试；接受前要先弄清哪些题目可能缺失。' },
        { title: '保护个人资料', text: '上传内容会交由系统配置的 AI 服务处理，尽量裁掉与解题无关的个人信息。' },
      ],
    },
  ],
}

export const TOUR_STEPS: Record<GuideRole, TourStep[]> = {
  teacher: [
    {
      id: 'teacher-navigation',
      path: '/',
      title: '主导航：所有功能从这里进入',
      description: '批改、试卷库、学生、错题本、统计和设置都在顶部。窄屏可打开菜单或横向滑动导航；教程入口会保持在帮助入口中。',
      selectors: ['[data-tour="main-nav"]', 'header nav'],
      guideAnchor: 'teacher-quickstart',
    },
    {
      id: 'teacher-students',
      path: '/students',
      title: '先建立学生档案与登录账号',
      description: '添加学生后，批改时就能分别归档。学生卡片中的账号管理可开通或重置登录密码；只有需要学生自行登录时才要开账号。',
      selectors: ['[data-tour="students"]', '[data-tour="student-create"]', 'input[placeholder^="学生姓名"]'],
      guideAnchor: 'teacher-students',
    },
    {
      id: 'teacher-papers',
      path: '/papers',
      title: '在试卷库录入题目与答案',
      description: '一次最多选择 30 个文件。识别后务必进入试卷核对题目和标准答案；答案在另一份文件中时可以后续补传。',
      selectors: ['[data-tour="papers"]', '[data-tour="paper-upload"]', 'input[placeholder^="试卷名称"]'],
      guideAnchor: 'teacher-papers',
    },
    {
      id: 'teacher-upload',
      path: '/',
      title: '选学生、选试卷，再上传作答',
      description: '首页把三个选择串成一次提交。作答一次最多 12 个文件；学生直接答在原试卷文件上时，老师也可选择复用试卷扫描件。',
      selectors: ['[data-tour="submission-upload"]', '[data-tour="submission-form"]', 'main > div > .card:first-child'],
      guideAnchor: 'teacher-grading',
    },
    {
      id: 'teacher-recent',
      path: '/',
      title: '从最近批改进入结果与人工复核',
      description: '打开一条记录可逐题查看判定、讲解和原卷，也可补拍补传、向 AI 提问。待确认与主观题需要老师判断，不能只看正确率。',
      selectors: ['[data-tour="recent-jobs"]', 'main a[href^="/jobs/"]', 'main > div > div:last-child'],
      guideAnchor: 'teacher-results',
    },
    {
      id: 'teacher-mistakes',
      path: '/mistakes',
      title: '错题本：复习、筛选与导出',
      description: '按学生、试卷、知识点或复习状态找到错题，重新作答并记录掌握情况。当前筛选结果可导出 CSV，也可打印用于离线练习。',
      selectors: ['[data-tour="mistakes"]', '[data-tour="mistake-list"]', 'main .card'],
      guideAnchor: 'review-plan',
    },
    {
      id: 'teacher-stats',
      path: '/stats',
      title: '统计要看口径，不只看一个百分比',
      description: '客观题正确率不包含待确认和主观题。结合知识点覆盖率、学生筛选和时间范围阅读；没有客观题时不应把它理解成 0% 掌握。',
      selectors: ['[data-tour="stats"]', '[data-tour="stats-overview"]', 'main .card'],
      guideAnchor: 'advanced-knowledge-stats',
    },
    {
      id: 'teacher-settings-help',
      path: '/settings',
      title: '设置与帮助：账号安全和随时重看',
      description: '这里可修改密码、退出登录；管理员还可处理账号与邀请。忘记密码时，学生找老师、老师找管理员。教程中可随时重播首次向导和页面导览。',
      selectors: ['[data-tour="settings-help"]', 'a[href="/guide"]', '[data-tour="settings"]', 'input[autocomplete="current-password"]'],
      guideAnchor: 'account-security',
    },
  ],
  student: [
    {
      id: 'student-navigation',
      path: '/',
      title: '你的学习入口都在主导航',
      description: '从「批改」上传作答，在「错题本」复习，在「统计」查看变化，在「设置」管理密码。教程和帮助入口可随时重新打开。',
      selectors: ['[data-tour="main-nav"]', 'header nav'],
      guideAnchor: 'student-quickstart',
    },
    {
      id: 'student-paper',
      path: '/',
      title: '第一步：选择已经完成的试卷',
      description: '只选择老师已经录入且与自己作答一致的试卷。没有可选试卷时请联系老师，不要上传另一份试卷代替。',
      selectors: ['[data-tour="paper-select"]', 'main select'],
      guideAnchor: 'student-login-paper',
    },
    {
      id: 'student-upload',
      path: '/',
      title: '第二步：拍照或选择作答文件',
      description: '支持 PDF、JPG、PNG、WebP、HEIC，一次最多 12 个文件。拍清题号和字迹、按顺序选择，确认无误后再提交。',
      selectors: ['[data-tour="submission-upload"]', '[data-tour="submission-form"]', 'main > div > .card:first-child'],
      guideAnchor: 'student-upload',
    },
    {
      id: 'student-recent',
      path: '/',
      title: '第三步：打开结果，看解析并提问',
      description: '最近批改会保存每次提交。进入记录后点击题号看详情；选中题目可问单题，清除题目焦点可问整卷。漏拍时可补拍补传。',
      selectors: ['[data-tour="recent-jobs"]', 'main a[href^="/jobs/"]', 'main > div > div:last-child'],
      guideAnchor: 'student-results',
    },
    {
      id: 'student-mistakes',
      path: '/mistakes',
      title: '错题不是看完就结束',
      description: '在错题本重新作答、查看答案与复习记录。按 1 / 3 / 7 / 16 / 30 天递进复习；答错会回到近期复习，也可以筛选今日到期。',
      selectors: ['[data-tour="mistakes"]', '[data-tour="mistake-list"]', 'main .card'],
      guideAnchor: 'review-plan',
    },
    {
      id: 'student-stats',
      path: '/stats',
      title: '用统计观察趋势和薄弱知识点',
      description: '正确率只针对已经判定的客观题，待确认与主观题另算。结合知识点覆盖情况和自己的多次记录看趋势，不被单次分数带偏。',
      selectors: ['[data-tour="stats"]', '[data-tour="stats-overview"]', 'main .card'],
      guideAnchor: 'advanced-knowledge-stats',
    },
    {
      id: 'student-settings-help',
      path: '/settings',
      title: '设置与帮助：密码和问题都有去处',
      description: '可在设置中修改自己的密码。忘记密码请联系老师重置；登录状态过期时重新登录。完整教程包含上传、识别失败和弱网排查。',
      selectors: ['[data-tour="settings-help"]', 'a[href="/guide"]', '[data-tour="settings"]', 'input[autocomplete="current-password"]'],
      guideAnchor: 'account-security',
    },
  ],
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'teacher-quickstart',
    role: 'teacher',
    category: 'quickstart',
    title: '老师快速开始：完成第一份批改',
    summary: '从建学生、录试卷到复核结果，先跑通一个小闭环。',
    keywords: ['老师', '新手', '三步', '第一次', '开始批改'],
    blocks: [
      { type: 'text', text: '第一次建议选择页数少、题号清楚、答案明确的试卷。跑通“试卷 → 作答 → 判分 → 复习”后，再处理长 PDF 或多人批量批改。' },
      {
        type: 'steps',
        title: '三个必要步骤',
        items: [
          '打开「学生」，添加学生档案；学生需要自行登录时，在卡片中开通账号并安全转交初始密码。',
          '打开「试卷库」，上传题目和标准答案；识别完成后进入试卷，逐题核对，缺答案可补传答案文件或手动填写。',
          '回到「批改」，选择学生、试卷和作答文件，点击「开始批改」。完成后先处理待确认，再查看解析和统计。',
        ],
      },
      { type: 'note', title: '最小验收方式', text: '先用一份已知答案的短试卷核对：题数是否一致、学生作答是否对号、标准答案是否正确、错题是否进入对应学生的错题本。' },
      { type: 'links', links: [{ label: '添加学生', to: '/students', icon: 'users' }, { label: '录入试卷', to: '/papers', icon: 'book' }, { label: '开始批改', to: '/', icon: 'pen' }] },
    ],
  },
  {
    id: 'teacher-students',
    role: 'teacher',
    category: 'workflow',
    title: '学生档案、登录账号与密码重置',
    summary: '分清“档案”和“账号”，正确组织多位学生的数据。',
    keywords: ['学生', '建档', '开通账号', '注销', '重置密码', '改名', '删除'],
    blocks: [
      { type: 'text', text: '学生档案用于归集批改、错题与统计；登录账号用于让学生自行上传和查看自己的结果。只有档案不代表学生已经能登录，「我自己」档案用于老师自己的练习。' },
      {
        type: 'steps',
        title: '创建与管理',
        items: [
          '在「学生」页输入姓名并添加。批改前选中正确学生，之后的错题与统计才会归到此人的记录下。',
          '点击非「我自己」学生卡片上的账号管理，设置用户名和至少 8 位初始密码。通过私密渠道分别转交用户名和密码，不要发到公开群聊。',
          '学生忘记密码时，由老师在同一入口设置新密码。重置后让学生重新登录；改名不会把历史记录转给别人。',
        ],
      },
      { type: 'list', title: '删除前要确认', items: ['注销登录账号后学生将无法登录，历史批改数据会保留；删除学生则是另一项操作，需单独确认。', '删除学生或试卷、批改记录属于高风险操作，先确认不再需要其历史数据；已有引用的资源可能被要求先删除关联记录。', '不要把一位学生的账号交给另一位学生使用，否则会混入他人的作答与答疑记录。'] },
      { type: 'links', links: [{ label: '管理学生', to: '/students', icon: 'users' }] },
    ],
  },
  {
    id: 'teacher-papers',
    role: 'teacher',
    category: 'workflow',
    title: '录入试卷：题目、答案与文件规则',
    summary: '支持混合上传、答案后补和纯手动建卷。',
    keywords: ['试卷', '上传', 'PDF', 'JPG', 'PNG', 'WebP', 'HEIC', '30', '答案文件', '手动建卷'],
    blocks: [
      { type: 'text', text: '在「试卷库 → 录入新试卷」中可上传含答案或不含答案的试卷，也可以先只传答案页。支持的文件为 PDF、JPG、PNG、WebP、HEIC，一次最多 30 个文件；总体积和页数还可能受服务器配置限制。' },
      {
        type: 'steps',
        title: '标准录卷流程',
        items: [
          '按页序选择文件并填写易辨认的试卷名称；名称留空时可由系统识别，之后仍能修改。',
          '点击「开始识别」并等待完成。识别中不要重复创建相同试卷；处理速度受页数、网络和 AI 服务影响。',
          '进入试卷核对题号、题干、选项、标准答案与知识点。答案在另一份文件时，使用「补传答案文件」，不必重建试卷。',
          '只有答案没有原卷时，可手动建卷或添加题号与答案；没有识别到题目时先补题，不要把空试卷用于新提交。',
        ],
      },
      { type: 'list', title: '提升识别质量', items: ['每页只保留清晰、正向、完整的内容，避免阴影、反光、裁掉题号和跨页混乱。', '多页 PDF 与照片可以组合使用，但文件顺序和页面顺序要可辨认。', 'HEIC 常见于 iPhone；若浏览器无法预览，仍可上传由服务端转换，失败时先在系统相册导出为 JPG 再试。'] },
      { type: 'links', links: [{ label: '打开试卷库', to: '/papers', icon: 'book' }] },
    ],
  },
  {
    id: 'teacher-answers',
    role: 'teacher',
    category: 'workflow',
    title: '核对题目、标准答案与答案版本',
    summary: '修正识别偏差，并理解修改答案对历史结果的影响。',
    keywords: ['标准答案', '题干', '选项', '知识点', '重判', '版本', '添加题目', '删除题目'],
    blocks: [
      { type: 'text', text: '自动识别不是最终定稿。开始新批改前，应检查缺答案提示、题号是否重复或错位、选择题选项是否完整、主观题类型是否恰当。可手动添加漏题、编辑内容或删除误识别题。' },
      { type: 'steps', title: '推荐核对顺序', items: ['先看题目总数与原卷是否一致，再看每道题是否归到正确大题。', '逐题核对标准答案；无标准答案的非选择题会进入待确认，不能把它当作自动判错。', '补充或修正知识点，便于错题归集与统计。批量补全后仍需抽查，不要让模型凭空填充。', '保存修改后再发起新作答；如果已有批改，留意自动重判结果与待确认数量。'] },
      { type: 'note', title: '答案版本会影响历史记录', text: '修改标准答案会重判该试卷下已有作答；题目、答案或判定变化后，旧讲解可能不再适用并需要重新生成。重新识别会尽量保留人工补题、编辑、清空答案和删除标记，但仍应抽查。', tone: 'warning' },
    ],
  },
  {
    id: 'teacher-grading',
    role: 'teacher',
    category: 'workflow',
    title: '发起批改：学生、试卷与作答上传',
    summary: '正确选择归属，处理上传限制和处理中状态。',
    keywords: ['开始批改', '作答', '拍照', '12', '复用试卷', '处理中', '上传'],
    blocks: [
      { type: 'steps', items: ['在首页选择实际作答的学生，不要为图方便都放到「我自己」。', '选择状态为就绪且题目、答案已核对的试卷；缺答案的题之后会成为待确认。', '拍照或从相册 / 文件上传作答，一次最多 12 个文件，支持 PDF、JPG、PNG、WebP、HEIC。', '若学生直接答在已经上传的试卷扫描件上，可勾选复用试卷文件，无需再传同一文件；普通作答不要勾选。', '确认文件名称、数量和顺序后点击「开始批改」，等待识别与判分完成。'] },
      { type: 'note', title: '不要重复提交', text: '上传或处理中时重复点击可能产生额外任务或触发限流。弱网后先回到最近批改确认是否已生成记录，再决定是否重试。', tone: 'warning' },
      { type: 'links', links: [{ label: '去批改', to: '/', icon: 'pen' }] },
    ],
  },
  {
    id: 'teacher-results',
    role: 'teacher',
    category: 'workflow',
    title: '批改结果、人工改判与 AI 答疑',
    summary: '读懂四种题目状态，复核之后再使用统计。',
    keywords: ['结果', '人工改判', '待确认', '主观题', '学生答案', '讲解', '答疑', '原卷'],
    blocks: [
      { type: 'list', title: '四种状态', items: ['答对 / 答错：已有可判定结果，但仍可能受识别错误影响。', '待确认（unknown）：作答模糊、缺标准答案或无法可靠比较，需要人工核对，不应直接算作错。', '主观题（subjective）：作文、简答等不适合简单自动比对，可结合 AI 点评后人工判断。'] },
      { type: 'steps', title: '复核一道题', items: ['打开最近批改并点击题号，对照学生作答、标准答案和原卷（有原卷时）。', '识别错学生答案时先修正作答；判定不对时使用「标为答对 / 答错 / 待确认」。无选项的文本作答也可在编辑入口修正。', '查看解析中的考点、答案分析、错因与技巧。答案或题目改变后重新生成讲解，避免沿用旧解析。', '选中题目后向 AI 问单题；清除单题焦点后可进行整卷答疑。提问时给出具体疑惑，比只问“为什么”更容易获得有用回答。'] },
      { type: 'note', title: 'AI 可能出错', text: 'AI 的识别、判分建议、解析和答疑都需要核对，尤其是多解、超纲、证明、作文及需要最新事实的问题。', tone: 'warning' },
    ],
  },
  {
    id: 'teacher-recovery',
    role: 'teacher',
    category: 'workflow',
    title: '补拍、失败重试与部分识别恢复',
    summary: '漏页或个别页面失败时，不必从头重做整份作业。',
    keywords: ['补拍', '补传', 'partial', '部分识别', '重试', '接受', '失败页', '重新识别'],
    blocks: [
      { type: 'steps', title: '按问题选择恢复方式', items: ['漏拍作答：打开原批改记录，使用「补拍补传」。作答文件累计不能超过 12 个，已有人工修正会按系统规则保留。', '试卷答案缺失：回到试卷使用「补传答案文件」，或在题目表中手动补答案；试卷单批文件最多 30 个。', '整体识别失败或效果不佳：检查文件后使用重新识别 / 重试。已经识别的相同文件可复用缓存，但人工修改仍需抽查。', '出现 partial：先查看失败文件和页码，优先重试失败页或原文件；不必为了失败页重新拍摄已成功的页面。'] },
      { type: 'note', title: '接受 partial 是明确让步', text: '接受不完整结果只适用于已经确认缺失范围、愿意保留当前可识别内容的情况。接受后缺失页面仍不会自动补齐；未确认的残缺试卷不应直接用于新提交。', tone: 'warning' },
      { type: 'links', links: [{ label: '检查最近批改', to: '/', icon: 'list' }, { label: '检查试卷库', to: '/papers', icon: 'book' }] },
    ],
  },
  {
    id: 'student-quickstart',
    role: 'student',
    category: 'quickstart',
    title: '学生快速开始：第一次拍照批改',
    summary: '选卷、上传、看结果，三步完成。',
    keywords: ['学生', '新手', '三步', '拍照', '第一次'],
    blocks: [
      { type: 'steps', items: ['登录后打开「批改」，在「做的哪份题？」中选择自己已经完成的试卷。', '拍照或从相册 / 文件选择作答，支持 PDF、JPG、PNG、WebP、HEIC，一次最多 12 个文件。', '点击「提交批改」，完成后打开结果；先看待确认和错题，再查看解析、提问并加入复习。'] },
      { type: 'note', title: '没有试卷可选？', text: '学生使用的是老师已录入的试卷。列表为空或找不到自己的试卷时，联系老师完成录卷，不要用不相符的试卷代替。' },
      { type: 'links', links: [{ label: '上传我的作答', to: '/', icon: 'camera' }, { label: '查看错题本', to: '/mistakes', icon: 'bookmark' }] },
    ],
  },
  {
    id: 'student-login-paper',
    role: 'student',
    category: 'workflow',
    title: '登录、选择试卷与保护账号',
    summary: '使用自己的学生账号，确保作答归入正确记录。',
    keywords: ['登录', '学生账号', '选择试卷', '用户名', '老师'],
    blocks: [
      { type: 'steps', items: ['使用老师为你开通的用户名和密码登录，不要借用同学账号。首次登录后可在「设置」修改密码。', '回到首页，在试卷下拉框中核对名称。老师尚未录入或仍在识别的试卷不会作为可提交试卷出现。', '提交后从「最近批改」进入自己的记录。若发现选错试卷，不要继续基于错误结果复习，应告诉老师并重新提交正确作答。'] },
      { type: 'note', title: '忘记密码', text: '学生账号由所属老师管理。忘记密码时直接联系老师重置，不需要创建新账号；重置后按页面提示重新登录。' },
      { type: 'links', links: [{ label: '选择试卷并上传', to: '/', icon: 'book-open' }, { label: '账号设置', to: '/settings', icon: 'settings' }] },
    ],
  },
  {
    id: 'student-upload',
    role: 'student',
    category: 'workflow',
    title: '拍照、上传与弱网注意事项',
    summary: '让 AI 看清题号和作答，避免重复与漏页。',
    keywords: ['拍照', '上传', 'HEIC', '弱网', '12', 'PDF', '补拍', '取消'],
    blocks: [
      { type: 'list', title: '拍清楚比拍得多更重要', items: ['在光线均匀处放平纸张，镜头正向、文字不变形，题号、选项和涂改痕迹要清楚。', '一张照片尽量只拍一页，避免手指、阴影和无关个人资料入镜；上传前逐张检查方向与清晰度。', '按作答顺序选择页面。支持 PDF、JPG、PNG、WebP、HEIC，一次最多 12 个文件，服务器还可能限制总体积与总页数。', 'HEIC 无法处理时，在 iPhone 相册中导出 / 转换为 JPG 后重试；不要为了压缩把字迹缩到无法辨认。'] },
      { type: 'steps', title: '提交后遇到情况', items: ['照片正在压缩或文件正在上传时，不要重复点击或关闭页面；需要取消时使用页面提供的取消入口。', '弱网中断后先等待网络恢复并刷新最近批改，确认是否已有记录，再决定重试。', '发现漏页时打开原记录使用「补拍补传」，不要创建多份相同作业；累计仍不能超过 12 个文件。'] },
      { type: 'links', links: [{ label: '去上传作答', to: '/', icon: 'upload' }] },
    ],
  },
  {
    id: 'student-results',
    role: 'student',
    category: 'workflow',
    title: '查看判分、原卷与逐题讲解',
    summary: '先理解状态，再针对不懂的地方学习。',
    keywords: ['结果', '答对', '答错', '待确认', '主观题', '讲解', '原卷', '误判'],
    blocks: [
      { type: 'list', title: '结果页怎么看', items: ['题号网格用于进入每道题；详情中学生答案、标准答案和判定分开显示。', '待确认不是一定答错，可能是字迹不清、缺答案或无法可靠识别，应等老师复核。', '主观题需要结合具体内容评价，不能只看客观题正确率。没有客观题时也不存在可计算的客观题正确率。', '有原卷时才显示原卷入口；没有原卷不影响查看已经识别出的题目内容。'] },
      { type: 'steps', title: '发现疑似误判', items: ['先打开题目详情，确认系统识别的学生作答与纸面一致。', '查看标准答案和解析，尝试说清自己认为哪里不一致。', '学生侧保持只读时，把具体试卷、题号和原因告诉老师，由老师修正作答或判定。'] },
      { type: 'note', title: '解析也需要思考', text: 'AI 讲解可能误解题意或给出不严谨步骤。把它当作一种解释，不要照抄；与老师课堂方法冲突时及时求证。', tone: 'warning' },
    ],
  },
  {
    id: 'student-chat',
    role: 'student',
    category: 'workflow',
    title: '向 AI 家教提问：单题与整卷',
    summary: '问得具体，并核对 AI 的回答。',
    keywords: ['AI', '答疑', '提问', '单题', '整卷', '讲解失败', '输入法'],
    blocks: [
      { type: 'steps', items: ['问单题：先在题目网格选中一道题，再输入“我这一步为什么错”“请用另一种方法解释”等具体问题。', '问整卷：清除单题焦点，让面板显示整卷答疑，再询问薄弱知识点、复习顺序或整卷总结。', '查看历史回答时确认自己仍在原来的试卷和题目；切换题目后应使用对应题目的新对话上下文。', '中文输入法组词时按 Enter 是确认候选，不应意外发送；确认文字上屏后再发送。'] },
      { type: 'list', title: '更好用的提问方式', items: ['说明自己已经尝试到哪一步，而不是只问“这题怎么做”。', '要求 AI 指出依据、检查计算或给出同类题，再由自己独立完成。', '讲解或答疑失败时先重试；持续失败则记录题目与时间，通过问题反馈或联系老师排查。'] },
      { type: 'note', title: '不要输入无关隐私', text: '题目和答疑内容会交由系统配置的 AI 服务处理，不要在聊天中发送密码、身份证号、家庭住址等信息。', tone: 'warning' },
    ],
  },
  {
    id: 'advanced-partial',
    role: 'all',
    category: 'advanced',
    title: '部分识别（partial）与可恢复失败',
    summary: '区分可查看的部分结果和完整、可用于学习的结果。',
    keywords: ['partial', '部分识别', '失败页', '重试', '接受', '缺页'],
    blocks: [
      { type: 'text', text: 'partial 表示一部分页面成功、一部分页面失败。页面会尽量保留可识别内容并给出警告，不会把失败页静默当作空白页。先查看文件清单、失败页和缺失范围，再决定下一步。' },
      { type: 'steps', items: ['优先点击失败页重试或原文件重试，并等待任务完成。重试失败提交通常不需要重新上传已经成功识别的照片。', '如果文件本身损坏、曝光过度或格式无法解码，替换 / 删除坏文件后重试；确认页序和数量没有超过限制。', '只有在明确接受缺失影响时才选择“接受不完整结果”。接受不是修复，缺失内容仍需之后补传或人工补齐。'] },
      { type: 'note', title: '学生如何处理', text: '学生看到 partial 时先尝试页面提供的重试，并告知老师哪些页可能缺失。不要在未核对的情况下把部分结果当作完整成绩。', tone: 'warning' },
    ],
  },
  {
    id: 'advanced-knowledge-stats',
    role: 'all',
    category: 'advanced',
    title: '知识点、统计范围与正确率口径',
    summary: '理解覆盖率、待确认和班级 / 个人趋势的区别。',
    keywords: ['统计', '正确率', '知识点', '覆盖率', '时间范围', '主观题', '待确认', '班级'],
    blocks: [
      { type: 'list', title: '读统计前先看四件事', items: ['学生范围：个人趋势只连接同一学生的记录；全部学生视图用于班级汇总，不能把不同学生连成一条个人进步线。', '时间范围：切换日期范围后，趋势、分布与列表应使用同一筛选口径。', '题目范围：客观题正确率通常按答对数 ÷（答对数 + 答错数）计算，待确认与主观题单独展示。没有可判定客观题时，应显示“未产生客观题正确率”，不是全对，也不是 0%。', '知识点覆盖：只有具有知识点信息的题目才进入知识点统计。覆盖不足时，分布只代表已标注或错题样本，不等于完整能力画像。'] },
      { type: 'steps', title: '用统计安排学习', items: ['先处理待确认，避免把未决题目误当成掌握或薄弱。', '结合多次记录看趋势，不用单次波动判断进步或退步。', '在知识点分布中回到具体错题复习；知识点为空时先由老师补全或核对，再解读覆盖率。'] },
      { type: 'links', links: [{ label: '查看统计', to: '/stats', icon: 'chart' }, { label: '回到错题本', to: '/mistakes', icon: 'bookmark' }] },
    ],
  },
  {
    id: 'review-plan',
    role: 'all',
    category: 'review',
    title: '错题复习：1 / 3 / 7 / 16 / 30 天',
    summary: '重新作答、记录结果，用递进间隔巩固而不是只看答案。',
    keywords: ['复习', '错题', '1/3/7/16/30', '掌握', '到期', '答错', '复习记录'],
    blocks: [
      { type: 'text', text: '错题本把不同试卷中的错题集中起来。复习间隔按 1、3、7、16、30 天逐步拉长；具体到期时间以页面显示为准。答错会重新进入近期复习，而不是继续保持长间隔。' },
      { type: 'steps', title: '一次有效复习', items: ['筛选“今日到期”或“待复习”，老师可先选学生；需要集中练习时再按试卷、知识点、日期或关键词缩小范围。', '打开原题，先隐藏答案并独立重新作答，再提交复习结果。不要只看一遍解析就标记掌握。', '答对后按阶段进入下一次复习，答错后回到近期复习。查看复习记录，确认连续答对和最近作答是否符合自己的真实感受。', '已经稳定掌握的题可标记已掌握；需要再练时恢复。原题答案或判定修正后，应重新检查对应复习内容。'] },
      { type: 'note', title: '学生与老师看到的范围不同', text: '学生只复习自己的错题；老师可按学生筛选并辅导。掌握状态用于安排复习，不应替代正式成绩或课堂评价。' },
      { type: 'links', links: [{ label: '开始复习', to: '/mistakes', icon: 'clock' }] },
    ],
  },
  {
    id: 'export-print',
    role: 'all',
    category: 'review',
    title: '错题筛选、CSV 导出与打印',
    summary: '导出的是当前筛选结果，打印前也要确认范围。',
    keywords: ['CSV', '导出', '打印', '筛选', '错题', 'Excel', '教程打印'],
    blocks: [
      { type: 'steps', title: '导出一份需要的错题清单', items: ['先在错题本设置学生、试卷、知识点、日期、掌握状态或关键词等筛选条件。', '检查当前列表，再点击导出 CSV。导出范围是当前筛选结果，不一定是全部错题。', '用表格软件打开时如中文乱码，选择 UTF-8 编码导入；公式样式开头的文本不要直接当作可执行公式处理。', '需要纸面练习时使用错题本打印，并确认是否隐藏答案、是否只打印当前筛选。教程页右上角的“打印教程”则打印当前角色标签下的完整教程。'] },
      { type: 'note', title: '导出文件同样含学习资料', text: 'CSV 和打印件可能含学生姓名、题目与作答，请只保存到可信位置，分享前移除不必要的个人信息。' },
      { type: 'links', links: [{ label: '筛选并导出错题', to: '/mistakes', icon: 'download' }] },
    ],
  },
  {
    id: 'account-security',
    role: 'all',
    category: 'account',
    title: '账号安全、会话过期与忘记密码',
    summary: '按角色找到正确的重置路径，不用共享账号。',
    keywords: ['密码', '忘记密码', '学生找老师', '老师找管理员', '会话', '退出', '安全', '邀请码'],
    blocks: [
      { type: 'list', title: '密码与会话', items: ['使用至少 8 位、不与其他网站重复的密码；不要通过题目截图、答疑或公开群聊发送密码。', '在「设置」修改密码。改密或被重置后，其他设备的旧会话可能失效，按提示重新登录；当前设备是否保留以页面返回为准。', '看到“会话过期 / 未授权”时先重新登录，不要反复上传。登录成功后回到原目标页面，再检查刚才的操作是否已经保存。', '离开共用设备时主动退出登录。学生只能访问自己的记录，老师也只应管理自己名下的数据。'] },
      { type: 'steps', title: '忘记密码时按角色处理', items: ['学生：联系所属老师，由老师在「学生」的账号管理中重置密码。', '老师：联系管理员，由管理员在设置中的老师账号管理入口重置；不要通过注册新账号绕开。', '管理员：使用部署方提供的本机管理员密码重置脚本 / 管理流程。本机操作需要服务器权限，普通老师与学生无法自行执行。'] },
      { type: 'list', title: '注册与邀请', items: ['首个账号的初始管理员流程、开放注册与邀请码要求以登录页实时提示为准。', '需要邀请码时向管理员索取；邀请码不等于密码，也不要把可用邀请码公开发布。', '账号重置后若所有设备仍显示旧数据，先退出并重新登录，不要重复创建学生档案。'] },
      { type: 'links', links: [{ label: '打开账号设置', to: '/settings', icon: 'settings' }] },
    ],
  },
  {
    id: 'privacy-ai',
    role: 'all',
    category: 'account',
    title: 'AI 使用边界与上传隐私',
    summary: '了解数据为何上传、AI 哪里可能出错，以及如何减少风险。',
    keywords: ['隐私', 'AI', '上传', '敏感信息', '第三方', '安全', '数据'],
    blocks: [
      { type: 'text', text: '试卷和作答图片用于识别、判分与生成讲解，答疑文字用于生成回答。这些内容由系统配置的 AI 服务处理，并不等同于“只在浏览器本地处理”。浏览器内压缩照片也不代表数据不会发送到服务器。' },
      { type: 'list', title: '上传前可以做的事', items: ['裁去与教学无关的姓名、学号、联系方式、住址、证件和聊天记录；不要在密码框或答疑中粘贴秘密。', '只上传确有学习需要的页面，控制文件数量和接收人员，导出文件与打印件同样妥善保管。', '使用可信设备和网络；公共空间查看结果后及时退出，不将私有记录链接当作公开分享链接。'] },
      { type: 'note', title: '必须人工复核的场景', text: '标准答案、多解题、作文与证明、模糊字迹、知识点归类、统计解读和 AI 给出的事实性陈述都可能有误。AI 输出不能作为唯一的成绩、处分或健康等重大决定依据。', tone: 'warning' },
    ],
  },
]

export const LEARNING_CHECKLIST: Record<GuideRole, ChecklistItem[]> = {
  teacher: [
    { id: 'teacher-check-student', title: '建立一位学生档案', description: '需要学生登录时，同时开通账号并安全转交密码。', sectionId: 'teacher-students' },
    { id: 'teacher-check-paper', title: '录入并核对一份试卷', description: '题数、题号、选项、答案和知识点都检查过。', sectionId: 'teacher-papers' },
    { id: 'teacher-check-grade', title: '完成一次作答批改', description: '选择正确学生和试卷，上传最多 12 个作答文件。', sectionId: 'teacher-grading' },
    { id: 'teacher-check-review', title: '处理待确认与人工改判', description: '知道如何修正作答、判定并重新生成讲解。', sectionId: 'teacher-results' },
    { id: 'teacher-check-recovery', title: '了解补拍与 partial 恢复', description: '会区分重试、补传和接受不完整结果。', sectionId: 'teacher-recovery' },
    { id: 'teacher-check-plan', title: '建立错题复习与导出习惯', description: '理解 1 / 3 / 7 / 16 / 30 天计划和筛选导出范围。', sectionId: 'review-plan' },
    { id: 'teacher-check-security', title: '检查账号与隐私路径', description: '知道老师忘密找管理员，上传前移除无关敏感信息。', sectionId: 'account-security' },
  ],
  student: [
    { id: 'student-check-login', title: '用自己的账号登录并选对试卷', description: '没有试卷时会联系老师，不借用同学账号。', sectionId: 'student-login-paper' },
    { id: 'student-check-upload', title: '完成一次清晰作答上传', description: '核对页序与数量，一次最多 12 个文件。', sectionId: 'student-upload' },
    { id: 'student-check-result', title: '看懂四种判定状态', description: '知道待确认不是答错，疑似误判会告诉老师。', sectionId: 'student-results' },
    { id: 'student-check-chat', title: '完成一次具体提问', description: '能区分单题与整卷答疑，并核对 AI 回答。', sectionId: 'student-chat' },
    { id: 'student-check-review', title: '完成一次错题重新作答', description: '理解 1 / 3 / 7 / 16 / 30 天递进与答错重回近期。', sectionId: 'review-plan' },
    { id: 'student-check-security', title: '知道密码与隐私怎么处理', description: '忘密找老师，不上传无关个人信息。', sectionId: 'account-security' },
  ],
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-formats-limits',
    role: 'all',
    question: '支持哪些格式？一次能传多少文件？',
    answer: '支持 PDF、JPG、PNG、WebP、HEIC。新建试卷或单批补传试卷文件一次最多 30 个；学生作答一次最多 12 个，补拍后的累计文件数也不能超过 12 个。',
    details: ['服务器还可能配置总上传体积和总页数上限，以实际错误提示为准。', '文件扩展名正确但内容损坏仍会被拒绝；请重新导出，不要只改扩展名。'],
    keywords: ['格式', '数量', '30', '12', 'PDF', 'JPG', 'PNG', 'WebP', 'HEIC'],
  },
  {
    id: 'faq-heic',
    role: 'all',
    question: 'iPhone 的 HEIC 照片传不上或无法预览怎么办？',
    answer: '系统支持 HEIC，但个别浏览器不能直接在本地解码或预览。可以先保持原文件上传，由服务端处理；仍失败时，在相册中导出 / 转换为 JPG 后重试。',
    details: ['不要通过猛烈压缩牺牲小字号和手写笔迹。', '若只有某一张照片失败，单独转换该照片，避免整批重复上传。'],
    keywords: ['HEIC', 'HEIF', 'iPhone', '苹果', '转换', 'JPG'],
  },
  {
    id: 'faq-weak-network',
    role: 'all',
    question: '弱网、上传中断或页面卡住时怎么处理？',
    answer: '先保持页面并等待当前压缩 / 上传结束；网络恢复后刷新最近批改或试卷库，确认任务是否已经创建，再决定是否重试。',
    details: ['正在压缩或上传时不要连续点击提交，也不要立即关闭页面。', '如果已经生成处理中记录，打开原记录等待即可，不要再建一份相同任务。', '持续失败时保留时间、文件格式和页面错误，通过问题反馈提交诊断。'],
    keywords: ['弱网', '断网', '上传失败', '超时', '取消', '重复提交', '卡住'],
  },
  {
    id: 'faq-partial',
    role: 'all',
    question: 'partial（部分识别）是什么意思？该重试还是接受？',
    answer: '它表示只有部分页面成功。优先查看失败文件 / 页码并重试；只有明确知道缺失内容且愿意承担影响时，才接受不完整结果。',
    details: ['接受不会修复失败页，也不会把缺失题目补回来。', '学生应把缺失范围告诉老师；老师不应把未确认的残缺试卷直接用于新提交。'],
    keywords: ['partial', '部分识别', '接受', '重试', '失败页'],
  },
  {
    id: 'faq-recognition-failed',
    role: 'all',
    question: '识别完全失败、题目为空或题号对不上怎么办？',
    answer: '先检查文件是否清晰、完整、方向正确，再使用重新识别 / 重试。题目为空时先补题或修复识别，不要把空试卷当成已就绪。',
    details: ['题号错位或同号题归错时，老师应在试卷中编辑、拆分或补题，并核对标准答案。', '重新识别后即使系统会保留人工编辑，也要抽查关键题目和已有批改。'],
    keywords: ['识别失败', '0 题', '空试卷', '题号', '重新识别', '错页'],
  },
  {
    id: 'faq-unknown',
    role: 'all',
    question: '为什么会出现“待确认”？它会算作答错吗？',
    answer: '待确认常见于作答模糊、缺少标准答案或无法可靠比对，需要老师人工核对。它不等于答错，也不应纳入客观题对错分母。',
    details: ['老师先核对系统识别的学生答案，再核对标准答案和判定。', '学生不要自行把待确认当错题刷，可先查看原题并联系老师。'],
    keywords: ['待确认', 'unknown', '正确率', '模糊', '缺答案'],
  },
  {
    id: 'faq-subjective',
    role: 'all',
    question: '作文、简答等主观题为什么没有普通对错？',
    answer: '主观题不能用简单的标准答案字符串可靠判定，因此单独标记。可以使用 AI 点评或答疑辅助，但最终评价应由老师结合评分要求完成。',
    details: ['没有客观题的记录不会凭空产生客观题正确率。', '主观题与待确认应在统计中单独查看。'],
    keywords: ['主观题', '作文', '简答', 'subjective', '判分'],
  },
  {
    id: 'faq-explanation-failed',
    role: 'all',
    question: '讲解一直生成中、失败或内容不对怎么办？',
    answer: '先等待当前生成任务结束并使用页面重试入口；持续失败时检查网络，稍后再试或通过问题反馈提交具体试卷和题号。',
    details: ['题目、标准答案或判定修改后，旧讲解可能失效，需要重新生成。', 'AI 讲解可能误解题意，即使生成成功也要核对，不要重复刷屏请求。'],
    keywords: ['讲解失败', '生成中', 'AI', '答疑失败', '重新生成'],
  },
  {
    id: 'faq-answer-change',
    role: 'teacher',
    question: '修改标准答案后，历史批改为什么变了？',
    answer: '标准答案更新会触发该试卷已有作答的重判，让历史结果使用最新答案。题目或判定变化也可能使旧讲解失效。',
    details: ['保存前先确认答案版本，保存后检查答对、答错和待确认数量。', '重新识别或补传后，也应抽查人工编辑是否仍符合预期。'],
    keywords: ['答案版本', '重判', '历史记录', '修改答案', '旧讲解'],
  },
  {
    id: 'faq-review-schedule',
    role: 'all',
    question: '复习间隔怎样递进？答错后会怎样？',
    answer: '复习阶段按 1、3、7、16、30 天递进。答错会重新进入近期复习；已掌握的题也可以恢复练习。',
    details: ['以错题本显示的下次到期时间和复习记录为准。', '建议先独立重新作答再看答案，不要把“看过解析”当成掌握。'],
    keywords: ['复习', '1', '3', '7', '16', '30', '掌握', '到期'],
  },
  {
    id: 'faq-export-scope',
    role: 'all',
    question: 'CSV 导出为什么不是全部错题？',
    answer: '错题本导出默认对应当前筛选结果。学生、试卷、知识点、日期、复习状态和关键词都可能缩小范围。',
    details: ['需要完整导出时先清空筛选并核对列表。', '表格软件中文乱码时用 UTF-8 导入；导出文件也要按私人学习资料保管。'],
    keywords: ['CSV', '导出', '筛选', '打印', '乱码'],
  },
  {
    id: 'faq-session-expired',
    role: 'all',
    question: '提示会话过期、未授权或突然退回登录页怎么办？',
    answer: '重新登录即可。密码修改或管理员 / 老师重置密码后，旧设备会话可能失效；不要通过重复上传来绕过登录。',
    details: ['登录后先回到原页面，检查刚才的修改或上传是否已经保存，再决定重试。', '共用设备还可能是切换了账号，应核对当前用户名并清空旧页面缓存状态。'],
    keywords: ['会话', '401', '过期', '未授权', '重新登录', '改密'],
  },
  {
    id: 'faq-forgot-password',
    role: 'all',
    question: '忘记密码分别找谁？',
    answer: '学生找所属老师重置；老师找管理员重置；管理员使用部署方提供的本机管理员密码重置脚本 / 管理流程。',
    details: ['不要通过注册新账号或借用他人账号解决，否则历史记录无法自动合并。', '重置后按提示重新登录，并用私密渠道转交新密码。'],
    keywords: ['忘记密码', '学生', '老师', '管理员', '重置', '本机脚本'],
  },
  {
    id: 'faq-no-paper',
    role: 'student',
    question: '学生为什么看不到试卷、标准答案或其他同学？',
    answer: '学生只能选择所属老师已经就绪的试卷，并查看自己的作答、错题和统计；标准答案管理和其他学生数据不向学生开放。',
    details: ['没有试卷时联系老师录卷。', '若看到自己的记录缺失，先核对是否登录了正确账号，再联系老师检查学生档案归属。'],
    keywords: ['学生权限', '看不到试卷', '标准答案', '同学', '归属'],
  },
  {
    id: 'faq-privacy',
    role: 'all',
    question: '照片和答疑只在本机处理吗？',
    answer: '不是。浏览器可能会在本地压缩照片，但识别、讲解和答疑仍需要服务器及系统配置的 AI 服务处理。',
    details: ['上传前裁去无关敏感信息，不要在答疑中发送密码或证件资料。', 'CSV、打印件和截图同样需要妥善保存与分享。'],
    keywords: ['隐私', '本地', '第三方 AI', '照片', '数据'],
  },
]
