export const APP_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export const LOGIN_TYPE_OPTIONS = [
  { value: 'jwt', label: 'JWT 令牌跳转' },
  { value: 'ticket', label: '一次性 Ticket' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'saml', label: 'SAML 2.0' },
  { value: 'form_based', label: '表单代填' },
];

export const CATEGORY_OPTIONS = [
  { value: 'business', label: '业务系统' },
  { value: 'data', label: '数据平台' },
  { value: 'devops', label: '研发运维' },
  { value: 'collaboration', label: '协同办公' },
  { value: 'other', label: '其他' },
];

export interface AppForm {
  name: string;
  code: string;
  description: string;
  icon: string;
  category: string;
  loginType: string;
  loginUrl: string;
  logoutUrl: string;
  callbackUrl: string;
  jwtExpiresIn: number;
  ticketExpiresIn: number;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthAuthUrl: string;
  oauthTokenUrl: string;
  oauthUserinfoUrl: string;
  oauthScope: string;
  samlIdpMetadataUrl: string;
  samlSpEntityId: string;
  visible: boolean;
  sortOrder: number;
  status: string;
  clientId: string;
}

export const emptyAppForm: AppForm = {
  name: '',
  code: '',
  description: '',
  icon: '',
  category: 'business',
  loginType: 'jwt',
  loginUrl: '',
  logoutUrl: '',
  callbackUrl: '',
  jwtExpiresIn: 30,
  ticketExpiresIn: 60,
  oauthClientId: '',
  oauthClientSecret: '',
  oauthAuthUrl: '',
  oauthTokenUrl: '',
  oauthUserinfoUrl: '',
  oauthScope: '',
  samlIdpMetadataUrl: '',
  samlSpEntityId: '',
  visible: true,
  sortOrder: 0,
  status: 'active',
  clientId: '',
};

export function suggestAppCode(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (APP_CODE_PATTERN.test(ascii)) return ascii.slice(0, 64);
  return `app_${Date.now().toString(36)}`.slice(0, 64);
}

export function formFromAppDetail(app: any): AppForm {
  return {
    ...emptyAppForm,
    name: app?.name || '',
    code: app?.code || '',
    description: app?.description || '',
    icon: app?.icon || '',
    category: app?.category || 'business',
    loginType: app?.loginType || 'jwt',
    loginUrl: app?.loginUrl || '',
    logoutUrl: app?.logoutUrl || '',
    callbackUrl: app?.callbackUrl || '',
    jwtExpiresIn: app?.jwtExpiresIn || 30,
    ticketExpiresIn: app?.ticketExpiresIn || 60,
    oauthClientId: app?.oauthClientId || '',
    oauthClientSecret: '',
    oauthAuthUrl: app?.oauthAuthUrl || '',
    oauthTokenUrl: app?.oauthTokenUrl || '',
    oauthUserinfoUrl: app?.oauthUserinfoUrl || app?.oauthUserInfoUrl || '',
    oauthScope: app?.oauthScope || '',
    samlIdpMetadataUrl: app?.samlIdpMetadataUrl || '',
    samlSpEntityId: app?.samlSpEntityId || '',
    visible: app?.visible ?? true,
    sortOrder: app?.sortOrder || 0,
    status: app?.status || 'active',
    clientId: app?.clientId || '',
  };
}

export function validateAppForm(form: AppForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = '请输入应用名称';
  if (!form.code.trim()) errors.code = '请输入应用编码';
  else if (!APP_CODE_PATTERN.test(form.code.trim())) {
    errors.code = '编码只能以字母开头，可包含字母、数字、下划线和中划线';
  }
  if (['jwt', 'ticket', 'form_based'].includes(form.loginType) && !form.loginUrl.trim()) {
    errors.loginUrl = '请填写登录地址';
  }
  if (form.loginType === 'oauth2' && !form.oauthAuthUrl.trim()) {
    errors.oauthAuthUrl = 'OAuth2 需要填写授权地址';
  }
  return errors;
}

export function buildAppPayload(form: AppForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    code: form.code.trim(),
    description: form.description.trim(),
    icon: form.icon.trim(),
    category: form.category,
    loginType: form.loginType,
    loginUrl: form.loginUrl.trim(),
    logoutUrl: form.logoutUrl.trim(),
    callbackUrl: form.callbackUrl.trim(),
    jwtExpiresIn: Number(form.jwtExpiresIn) || 30,
    ticketExpiresIn: Number(form.ticketExpiresIn) || 60,
    oauthClientId: form.oauthClientId.trim(),
    oauthAuthUrl: form.oauthAuthUrl.trim(),
    oauthTokenUrl: form.oauthTokenUrl.trim(),
    oauthUserinfoUrl: form.oauthUserinfoUrl.trim(),
    oauthScope: form.oauthScope.trim(),
    samlIdpMetadataUrl: form.samlIdpMetadataUrl.trim(),
    samlSpEntityId: form.samlSpEntityId.trim(),
    visible: form.visible,
    sortOrder: Number(form.sortOrder) || 0,
    status: form.status || 'active',
    clientId: form.clientId || '',
  };
  if (form.oauthClientSecret.trim() && !form.oauthClientSecret.startsWith('***')) {
    payload.oauthClientSecret = form.oauthClientSecret.trim();
  }
  return payload;
}
