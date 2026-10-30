import { mcpScopeDefinitions } from "@narada/contracts/mcp";
import type { ResourceRestrictions } from "@narada/contracts/delegation";
export const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const json = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");
export function page(title: string, body: string, nonce: string, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Narada</title><style nonce="${nonce}">body{font:16px system-ui;background:#f3f5ef;color:#203522;margin:0;padding:24px}main{max-width:760px;margin:24px auto;background:white;padding:28px;border:1px solid #ccd6c7;border-radius:12px}label{display:block;margin:12px 0}input:not([type=checkbox]):not([type=radio]){box-sizing:border-box;display:block;padding:10px;width:100%;margin-top:6px}button,a.button{display:inline-block;padding:10px 16px;margin:8px 8px 0 0;cursor:pointer}fieldset,article{margin:20px 0;padding:16px;border:1px solid #ccd6c7;border-radius:8px}p{line-height:1.5}#error{color:#9d251a}small{color:#4d5d50}code{overflow-wrap:anywhere}a{color:#345d37}input{accent-color:#345d37}.choices{max-height:300px;overflow:auto}button:disabled{cursor:wait;opacity:.6}</style></head><body><main><a href="/">Narada</a><h1>${escape(title)}</h1>${body}<p id="error" role="alert"></p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}
export function loginPage(nonce: string) {
  return page(
    "Sign in to Narada",
    `<p>Sign in to review this connection's permissions.</p><form><div id="credentials"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label></div><div id="factor" hidden><label>Authenticator or recovery code<input name="code" autocomplete="one-time-code"></label><label><input type="checkbox" name="backup">Use a recovery code</label></div><button>Sign in</button></form>`,
    nonce,
    `
const form=document.querySelector('form');let mfa=false;
form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const data=new FormData(form),oauth_query=location.search.slice(1);const body=mfa?{code:data.get('code'),oauth_query}:{email:data.get('email'),password:data.get('password'),...(oauth_query?{oauth_query}:{})};const endpoint=mfa?(data.get('backup')?'/api/auth/two-factor/verify-backup-code':'/api/auth/two-factor/verify-totp'):'/api/auth/sign-in/email';const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.message||result.error_description||'Sign in failed');if(result.twoFactorRedirect){mfa=true;document.querySelector('#credentials').hidden=true;document.querySelector('#factor').hidden=false;form.querySelector('[name=code]').required=true;form.querySelector('[name=password]').required=false;}else if(result.url)location.assign(result.url);else if(oauth_query)location.assign('/api/auth/oauth2/authorize?'+oauth_query);else location.assign('/oauth/connections');}catch(e){document.querySelector('#error').textContent=e.message;}finally{button.disabled=false;}});`,
  );
}
const labels = new Map<string, string>([
  ["openid", "Identify your Narada account"],
  ["offline_access", "Keep this connection active with refresh tokens"],
  ...mcpScopeDefinitions,
]);
export function selectionPage(
  nonce: string,
  user: string,
  client: string,
  requested: string[],
  options: {
    query?: string;
    reference?: string;
    revision?: number;
    resources?: ResourceRestrictions;
    clientId: string;
  },
) {
  const editing = !!options.reference;
  const resources = options.resources ?? {};
  const dimensions = [
    {
      key: "publicationIds",
      kind: "publications",
      label: "Publications and their issues",
    },
    { key: "formIds", kind: "forms", label: "Forms" },
    { key: "senderDomains", kind: "domains", label: "Sending domains" },
  ];
  return page(
    editing ? "Manage connection" : "Connect an app",
    `<p><strong>${escape(client)}</strong> ${editing ? "has access" : "is requesting access"} as <strong>${escape(user)}</strong>.</p><p>Client ID: <code>${escape(options.clientId)}</code>. Client names are supplied by the app.</p><p>${editing ? "Remove permissions or narrow resources here. Reconnect from the app to expand access." : "Choose what this connection may do. New permissions require fresh consent."}</p><p>Sending and publishing, including test emails, require your separate approval of the exact action in Narada. Selecting all permissions does not bypass review.</p><form><fieldset><legend>Permissions</legend><label><input type="radio" name="mode" value="all" checked> All ${editing ? "current" : "requested"} permissions</label><label><input type="radio" name="mode" value="selected"> Choose permissions</label><div class="choices">${requested.map((scope) => `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked disabled> ${escape(labels.get(scope) ?? scope)}</label>`).join("")}</div></fieldset><h2>Resource access</h2><p>Publication selections include their issues and signup forms. When multiple filters are selected, a resource must match every filter. Selecting specific IDs prevents creating new forms or publications.</p>${dimensions.map((d) => `<fieldset data-dimension="${d.key}" data-kind="${d.kind}"><legend>${d.label}</legend><label><input type="radio" name="${d.key}" value="all" ${resources[d.key as keyof ResourceRestrictions] ? "" : "checked"}> All ${d.kind}</label><label><input type="radio" name="${d.key}" value="selected" ${resources[d.key as keyof ResourceRestrictions] ? "checked" : ""}> Selected ${d.kind}</label><div class="choices" data-choices></div><button type="button" data-more>Load resources</button></fieldset>`).join("")}<button name="decision" value="allow">${editing ? "Save reduced access" : "Authorize connection"}</button>${editing ? '<a href="/oauth/connections">Cancel</a>' : '<button name="decision" value="deny" formnovalidate>Cancel</button>'}</form>`,
    nonce,
    `
const config=${json(options)},form=document.querySelector('form'),selected=${json(resources)},cursors={},loaded=new Set();
for(const field of form.querySelectorAll('[data-dimension]')){
 const key=field.dataset.dimension;selected[key]=new Set(selected[key]||[]);
 const add=(id,label)=>{if([...field.querySelectorAll('[data-resource]')].some(c=>c.value===id))return;const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=id;c.dataset.resource='true';c.checked=selected[key].has(id);c.addEventListener('change',()=>{c.checked?selected[key].add(id):selected[key].delete(id)});l.append(c,document.createTextNode(' '+label));field.querySelector('[data-choices]').append(l);};
 for(const id of selected[key]) add(id,id);
 field.querySelector('[data-more]').addEventListener('click',async e=>{e.preventDefault();e.target.disabled=true;try{const q=new URLSearchParams({kind:field.dataset.kind});if(cursors[key])q.set('cursor',cursors[key]);const r=await fetch('/oauth/resources?'+q);const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load resources');for(const row of data.data)add(row.id,row.label);cursors[key]=data.nextCursor;loaded.add(key);e.target.textContent=data.nextCursor?'Load more':'All resources loaded';e.target.hidden=!data.nextCursor;}catch(error){document.querySelector('#error').textContent=error.message;}finally{e.target.disabled=false;}});
}
form.addEventListener('change',()=>{const all=form.elements.mode.value==='all';form.querySelectorAll('[name=scope]').forEach(c=>c.disabled=all);});
form.addEventListener('submit',async e=>{e.preventDefault();const accept=e.submitter.value==='allow',mode=form.elements.mode.value,scopes=[...form.querySelectorAll('[name=scope]')].filter(c=>mode==='all'||c.checked).map(c=>c.value),resources={};for(const key of Object.keys(selected)){if(form.elements[key].value==='selected'){resources[key]=[...selected[key]];if(accept&&!resources[key].length){document.querySelector('#error').textContent='Select at least one resource for each selected filter.';return;}}}if(accept&&!scopes.length){document.querySelector('#error').textContent='Select at least one permission, or cancel.';return;}form.querySelectorAll('button').forEach(b=>b.disabled=true);try{const url=config.reference?'/oauth/connections/'+encodeURIComponent(config.reference):'/oauth/consent';const body=config.reference?{scopes,resources,revision:config.revision}:{accept,mode,scopes,resources:accept?resources:{},oauth_query:config.query};const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error||result.message||result.error_description||'Authorization failed');location.assign(result.url||'/oauth/connections');}catch(error){document.querySelector('#error').textContent=error.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}});`,
  );
}
export function connectionsPage(
  nonce: string,
  resource: string,
  connections: {
    reference: string;
    clientId: string;
    name: string;
    scopes: string[];
    resources: ResourceRestrictions;
    active: boolean;
  }[],
  nextCursor: string | null = null,
) {
  return page(
    "Connected apps",
    `<p>Connect your agent to <code>${escape(resource)}</code>. Review permissions when Narada opens in your browser.</p><p>Agent sends and publications require your approval in <a href="/?page=approvals">Send approvals</a>. Signing out leaves these connections active. Password reset revokes them. Revocation stops new calls; it does not undo accepted work.</p>${
      connections.length
        ? connections
            .map(
              (c) =>
                `<article><h2>${escape(c.name)}</h2><p><code>${escape(c.clientId)}</code> · ${c.active ? "Active" : "Disconnected"}</p><p>${c.scopes.map((s) => escape(labels.get(s) ?? s)).join(", ") || "No permissions"}</p><p>${
                  Object.entries(c.resources)
                    .map(
                      ([key, ids]) =>
                        `${escape(key)}: ${ids!.map(escape).join(", ")}`,
                    )
                    .join("; ") || "All resources"
                }</p><a class="button" href="/?page=activity&amp;clientId=${encodeURIComponent(c.clientId)}">View activity</a>${c.active ? `<a class="button" href="/oauth/connections/${encodeURIComponent(c.reference)}">Manage access</a><button data-revoke="${escape(c.reference)}">Disconnect</button>` : ""}</article>`,
            )
            .join("")
        : "<p>No connected apps on this page.</p>"
    }${nextCursor ? `<a class="button" href="/oauth/connections?cursor=${encodeURIComponent(nextCursor)}">Next page</a>` : ""}`,
    nonce,
    `document.querySelectorAll('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{const r=await fetch('/oauth/connections/'+encodeURIComponent(button.dataset.revoke)+'/revoke',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!r.ok)throw Error('Could not disconnect; reload and try again');location.reload();}catch(error){document.querySelector('#error').textContent=error.message;button.disabled=false;}}));`,
  );
}
