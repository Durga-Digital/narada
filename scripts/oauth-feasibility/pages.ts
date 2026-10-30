const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function page(title: string, body: string, nonce: string, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Narada</title><style nonce="${nonce}">body{font:16px system-ui;background:#f3f5ef;color:#203522;margin:0;padding:32px}main{max-width:640px;margin:40px auto;background:white;padding:32px;border:1px solid #ccd6c7;border-radius:12px}label{display:block;margin:16px 0}input:not([type=checkbox]):not([type=radio]){display:block;padding:10px;width:90%;margin-top:6px}button,a.button{padding:10px 18px;margin:10px 10px 0 0;cursor:pointer}fieldset{margin:20px 0;border:1px solid #ccd6c7}p{line-height:1.5}#error{color:#9d251a}small{color:#4d5d50}code{overflow-wrap:anywhere}</style></head><body><main><small>Narada · isolated local OAuth feasibility</small><h1>${escape(title)}</h1>${body}<p id="error" role="alert"></p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}
export const loginScript = `
const form=document.querySelector('form');
let mfa=false;
form.addEventListener('submit',async e=>{
 e.preventDefault();const button=form.querySelector('button');button.disabled=true;
 try{
  const data=new FormData(form),oauth_query=location.search.slice(1);
  const body=mfa?{code:data.get('code'),oauth_query}:{email:data.get('email'),password:data.get('password'),...(oauth_query?{oauth_query}:{})};
  const endpoint=mfa?(data.get('backup')?'/api/auth/two-factor/verify-backup-code':'/api/auth/two-factor/verify-totp'):'/api/auth/sign-in/email';
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json();if(!r.ok)throw Error(result.message||result.error_description||'Sign in failed');
  if(result.twoFactorRedirect){mfa=true;document.querySelector('#credentials').hidden=true;document.querySelector('#factor').hidden=false;form.querySelector('[name=code]').required=true;form.querySelector('[name=password]').required=false;}
  else if(result.url) location.assign(result.url);
  else if(oauth_query) location.assign('/api/auth/oauth2/authorize?'+oauth_query);
  else location.assign('/');
 }catch(e){document.querySelector('#error').textContent=e.message;}finally{button.disabled=false;}
});`;
export function loginPage(nonce: string) {
  return page(
    "Sign in to Narada",
    `<p>Use the temporary owner credentials saved by the feasibility server.</p><form><div id="credentials"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label></div><div id="factor" hidden><label>Authenticator or recovery code<input name="code" autocomplete="one-time-code"></label><label><input type="checkbox" name="backup">Use a recovery code</label></div><button>Sign in</button></form>`,
    nonce,
    loginScript,
  );
}
export function consentPage(
  nonce: string,
  user: string,
  client: string,
  scopes: { scope: string; label: string }[],
) {
  return page(
    "Connect an app",
    `<p><strong>${escape(client)}</strong> is requesting access as <strong>${escape(user)}</strong>.</p><p>Choose what this connection may do. New permissions will require fresh consent.</p><form><fieldset><legend>Permissions</legend><label><input type="radio" name="mode" value="all" checked> All requested permissions</label><label><input type="radio" name="mode" value="selected"> Choose permissions</label>${scopes.map((s) => `<label><input type="checkbox" name="scope" value="${escape(s.scope)}" checked disabled> ${escape(s.label)}</label>`).join("")}</fieldset><button name="decision" value="allow">Authorize connection</button><button name="decision" value="deny" formnovalidate>Cancel</button></form>`,
    nonce,
    `
const form=document.querySelector('form');
form.addEventListener('change',()=>{const all=form.elements.mode.value==='all';form.querySelectorAll('[name=scope]').forEach(c=>{c.disabled=all;});});
form.addEventListener('submit',async e=>{
 e.preventDefault();const accept=e.submitter.value==='allow',all=form.elements.mode.value==='all';
 const scope=[...form.querySelectorAll('[name=scope]')].filter(c=>all||c.checked).map(c=>c.value).join(' ');
 if(accept&&!scope){document.querySelector('#error').textContent='Select at least one permission, or cancel.';return;}
 form.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{const r=await fetch('/api/auth/oauth2/consent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accept,scope,oauth_query:location.search.slice(1)})});const result=await r.json();if(!r.ok)throw Error(result.message||result.error_description||'Authorization failed');location.assign(result.url);}
 catch(e){document.querySelector('#error').textContent=e.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
});`,
  );
}
export { escape };
