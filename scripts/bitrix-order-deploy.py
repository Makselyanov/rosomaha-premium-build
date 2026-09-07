"""Pinned two-file order repair; reuse reviewed Beget authentication internally."""
import argparse, hashlib, importlib.util, json, stat, sys, subprocess, shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('beget_operator', ROOT / 'scripts/bitrix-metrika-bridge-deploy.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TARGETS = {
    'bridge': 'local/php_interface/rosomaha_crm_bridge.php',
    'calculator': 'bitrix/templates/aspro-allcorp3/components/bitrix/catalog.element/main_custom/script.js',
}
EVIDENCE = ROOT / '.codex_tmp/bitrix-order-evidence'
PINS={'bridge':'29ea870f2d17c553844eeef5aa66acbe5fd9902a22b51bb53925525433985e67','calculator':'0aca5409a8b85a84a48c0ec28f3525241ed2000454898f10cef5af2dd330b286'}

def apply(client):
    files=['scripts/bitrix-order-deploy.py']+['integrations/legacy-bitrix/'+x for x in TARGETS.values()]
    if subprocess.check_output(['git','status','--porcelain','--',*files],cwd=ROOT).strip(): raise RuntimeError('Uncommitted release files')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    backup=base.OPERATION_PARENT+'/order-options-'+commit[:12]
    lock_path=base.TRANSACTION_LOCK_PATH
    lock_body=('order-options:'+commit).encode()
    switched=[]
    with client.open_sftp() as sftp:
        base._require_pinned_parent(sftp,base.OPERATION_PARENT)
        base._write_exact_file(sftp,lock_path,lock_body)
        try:
            plans={}
            for key,relative in TARGETS.items():
                remote=base.SITE_ROOT+'/'+relative
                for parent in [base.SITE_ROOT,remote.rsplit('/',1)[0]]:
                    info=sftp.lstat(parent)
                    if not stat.S_ISDIR(info.st_mode): raise RuntimeError('Symlink parent refused')
                old,info=base.read_remote_file(sftp,remote)
                if digest(old)!=PINS[key]: raise RuntimeError('Production source drift')
                candidate=(ROOT/'integrations/legacy-bitrix'/relative).read_bytes()
                plans[key]={'path':remote,'old':old,'candidate':candidate,'stage':remote+'.order-'+commit[:12]}
            sftp.mkdir(backup,0o700)
            for key,plan in plans.items():
                base._write_exact_file(sftp,backup+'/'+key+'.before',plan['old'])
                base._write_exact_file(sftp,plan['stage'],plan['candidate'])
            php=base.discover_php(client)
            code,out,err=base._exec_bounded(client,shlex.quote(php)+' -l '+shlex.quote(plans['bridge']['stage']))
            if code!=0: raise RuntimeError('PHP lint failed')
            for key,plan in plans.items():
                current,_=base.read_remote_file(sftp,plan['path'])
                if digest(current)!=PINS[key]: raise RuntimeError('Source changed before swap')
                sftp.posix_rename(plan['stage'],plan['path'])
                switched.append(key)
                current,_=base.read_remote_file(sftp,plan['path'])
                if current!=plan['candidate']: raise RuntimeError('Readback mismatch')
            result={'status':'applied','commit':commit,'backup':backup,'files':{k:{'sha256':digest(p['candidate']),'backup_sha256':digest(p['old'])} for k,p in plans.items()}}
            base._write_exact_file(sftp,backup+'/receipt.json',json.dumps(result).encode())
            (EVIDENCE/'release.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
            print(json.dumps(result))
        except Exception:
            for key in reversed(switched):
                plan=plans[key]
                current,_=base.read_remote_file(sftp,plan['path'])
                if current!=plan['candidate']: raise RuntimeError('Rollback requires inspection: concurrent change')
                restore=plan['stage']+'.restore'
                base._write_exact_file(sftp,restore,plan['old'])
                sftp.posix_rename(restore,plan['path'])
                current,_=base.read_remote_file(sftp,plan['path'])
                if current!=plan['old']: raise RuntimeError('Rollback readback failed')
            raise
        finally:
            with sftp.open(lock_path,'rb') as handle: current=handle.read()
            if current!=lock_body: raise RuntimeError('Lock ownership changed')
            sftp.remove(lock_path)

def digest(data): return hashlib.sha256(data).hexdigest()

def snapshot(sftp):
    result = {}
    for key, relative in TARGETS.items():
        remote = base.SITE_ROOT + '/' + relative
        attrs = sftp.lstat(remote)
        if not stat.S_ISREG(attrs.st_mode) or attrs.st_size > 500000:
            raise RuntimeError('Unexpected source file metadata')
        with sftp.open(remote, 'rb') as handle: data = handle.read()
        result[key] = {'relative': relative, 'sha256': digest(data), 'bytes': len(data), 'mode': stat.S_IMODE(attrs.st_mode)}
        (EVIDENCE / (key + '.baseline')).write_bytes(data)
    return result

def main():
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--audit', action='store_true')
    group.add_argument('--apply', action='store_true')
    args=parser.parse_args()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    client=base.connect(env_path=Path('G:/mvp/rosomaha/.env'))
    try:
        if args.apply:
            apply(client)
            return
        with client.open_sftp() as sftp:
            result=snapshot(sftp)
            queue=base.SITE_ROOT+'/local/php_interface/.rosomaha_crm_bridge'
            pending=[name for name in sftp.listdir(queue) if name.startswith('pending-') and name.endswith('.json')]
            entries=[]
            for name in pending:
                with sftp.open(queue+'/'+name,'rb') as handle: record=json.loads(handle.read())
                entries.append({key:record.get(key) for key in ['form_id','result_id','attempts','last_http_code','last_error','next_attempt_at','crm_ack']})
            result['queue']={'pending_count':len(pending),'entries':entries}
        (EVIDENCE / 'baseline.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'status':'audited','files':result}))
    finally: client.close()

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('ERROR: '+type(error).__name__,file=sys.stderr)
        raise SystemExit(1)
