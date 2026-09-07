#!/usr/bin/env python3
"""Provision only the missing CRM technical sender; never reset an existing mailbox."""
import importlib.util
import json
from pathlib import Path
import secrets
import ssl
import subprocess
import sys
from urllib.parse import urlencode
from urllib.request import Request,build_opener,ProxyHandler,HTTPSHandler

ROOT=Path(__file__).resolve().parents[1]
def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/filename)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return module

def remote(mode,body=None):
    if mode not in ['preflight','stage','install']:raise RuntimeError('mode')
    result=subprocess.run(['ssh','-o','BatchMode=yes','root@90.156.168.115',
        'python3 /var/www/crm/scripts/deploy/install-beget-mail-relay.py --'+mode],
        input=json.dumps(body or {}).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
    if result.returncode:raise RuntimeError('remote_failed')
    value=json.loads(result.stdout)
    if not isinstance(value,dict):raise RuntimeError('remote_shape')
    return value

def main():
    if sys.argv[1:]!=['--apply']:raise RuntimeError('explicit_apply_required')
    tracked=['scripts/beget-crm-mail-audit.py','scripts/beget-crm-mail-provision.py','scripts/bitrix-metrika-bridge-deploy.py']
    for file in tracked:subprocess.run(['git','ls-files','--error-unmatch',file],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    if subprocess.check_output(['git','status','--porcelain','--',*tracked],cwd=ROOT):raise RuntimeError('uncommitted')
    audit=load('mailaudit','beget-crm-mail-audit.py')
    state,code=audit.audit()
    if code or not state['owned'] or state['target_exists'] or state['count']!=0:raise RuntimeError('scope_mismatch')
    before=remote('preflight')
    password=secrets.token_urlsafe(40)
    remote('stage',{'password':password,'expected_env_sha':before['env_sha256']})
    loader=load('mailcredentials','bitrix-metrika-bridge-deploy.py')
    login,api_password=loader.load_credentials(environ={},env_path=Path('G:/mvp/rosomaha/.env'))
    if login!='berkutm4':raise RuntimeError('account')
    endpoint='https://api.beget.com/api/mail/createMailbox'
    body=urlencode({'login':login,'passwd':api_password,'input_format':'json','output_format':'json',
        'input_data':json.dumps({'domain':'rosomaha.site','mailbox':'crm','mailbox_password':password})}).encode()
    request=Request(endpoint,data=body,method='POST',headers={'Content-Type':'application/x-www-form-urlencoded'})
    opener=build_opener(ProxyHandler({}),audit.NoRedirect(),HTTPSHandler(context=ssl.create_default_context()))
    with opener.open(request,timeout=25) as response:
        if response.status!=200 or response.geturl()!=endpoint:raise RuntimeError('provider_response')
        data=response.read(65537)
    if len(data)>65536:raise RuntimeError('response_size')
    result=json.loads(data)
    if result.get('status')!='success' or result.get('answer',{}).get('status')!='success' or result['answer'].get('result') is not True:
        raise RuntimeError('create_unconfirmed_do_not_retry')
    state,code=audit.audit()
    if code or not state['owned'] or not state['target_exists'] or state['count']!=1:raise RuntimeError('readback_mismatch')
    installed=remote('install')
    print(json.dumps({'status':'installed','mailbox_created':True,'smtp_authenticated':True,'installer':installed}))

if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'status':'stopped','instruction':'Inspect protected stage; do not repeat mailbox creation.'}))
        raise SystemExit(1)
