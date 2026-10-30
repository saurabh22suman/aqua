#!/usr/bin/env python3
"""One bounded disposable preview + rendered test; invoke ONLY through lane_job.py."""
from pathlib import Path
import argparse,importlib.util,subprocess,time,os,signal,socket,urllib.request
R=Path(__file__).resolve().parents[2]
def table():
 out={}
 for p in Path('/proc').glob('[0-9]*'):
  try:
   s=(p/'stat').read_text().rsplit(') ',1)[1].split();out[int(p.name)]=(int(s[1]),s[19])
  except (OSError,ValueError,IndexError):pass
 return out
def descendants(pid,t):
 result=[]
 for child,(parent,start) in t.items():
  if parent==pid:result+=descendants(child,t)+[(child,start)]
 return result

def stop(child):
 t=table();owned=descendants(child.pid,t)+([(child.pid,t[child.pid][1])] if child.pid in t else [])
 for sig in (signal.SIGTERM,signal.SIGKILL):
  now=table()
  for pid,start in owned:
   if now.get(pid,(None,None))[1]==start:
    try:os.kill(pid,sig)
    except ProcessLookupError:pass
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:pass
  if sig==signal.SIGTERM:time.sleep(.2)

def main():
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,required=True);p.add_argument('--timeout',type=int,default=240);p.add_argument('--out',required=True);p.add_argument('--production',action='store_true');p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args();cmd=a.command[1:] if a.command[:1]==['--'] else a.command
 if not cmd or not 1024<=a.port<=65535 or not 1<=a.timeout<=900:p.error('port, bounded timeout and check command required')
 spec=importlib.util.spec_from_file_location('h',R/'.opencode/scripts/harness.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
 env=h.checked_test_env(R/'.env.aqua-harness-test.local');identity=h.db_identity(env)
 if identity['role']!='app_login' or not identity['db'].startswith('aqua_test_'):raise RuntimeError('Refusing non-disposable runtime')
 if h.next_processes():raise RuntimeError('Preserving existing Next process; no server started')
 with socket.socket() as probe:
  probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',a.port))
 out=(R/a.out).resolve()
 if not out.is_relative_to(R):raise RuntimeError('Evidence must be in own worktree')
 out.mkdir(parents=True,exist_ok=True)
 # Never pass privileged DB credentials or enabled external providers to the web.
 web={k:v for k,v in env.items() if k not in ['MIGRATION_DATABASE_URL','APP_LOGIN_PASSWORD'] and not k.startswith(('OPS_','WHATSAPP_','R2_','AWS_'))}
 base=f'http://127.0.0.1:{a.port}';web.update(NODE_ENV='production' if a.production else 'development',BETTER_AUTH_URL=base,WHATSAPP_PROVIDER='disabled',AQUA_DEPLOYMENT_STAGE='preview',NEXT_TELEMETRY_DISABLED='1',DEMO_MODE='false')
 if a.production:subprocess.run(['pnpm','exec','tsx','-e',"import {requireBudgetBuild} from './scripts/lib/budget-build-receipt';requireBudgetBuild();"],cwd=R,env=web,check=True)
 checkenv=dict(env,AQUA_E2E_BASE_URL=base,AQUA_E2E_PORT=str(a.port),AQUA_E2E_OUT=str(out),BETTER_AUTH_URL=base)
 server=check=None
 try:
  with (out/'server.log').open('w') as log:
   server=subprocess.Popen(['pnpm','exec','next','start' if a.production else 'dev','--hostname','127.0.0.1','--port',str(a.port)],cwd=R,env=web,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   deadline=time.monotonic()+120
   while True:
    if server.poll() is not None:raise RuntimeError('Owned server exited before readiness')
    try:
     with urllib.request.urlopen(base+'/login',timeout=4) as response:
      if response.status==200:break
    except OSError:pass
    if time.monotonic()>=deadline:raise RuntimeError('Owned preview readiness exceeded120s')
    time.sleep(.5)
   # Reject a different process listening on our port even after the bind probe.
   ss=subprocess.run(['ss','-ltnp',f'sport = :{a.port}'],capture_output=True,text=True,check=True).stdout
   import re
   listener={int(x) for x in re.findall(r'pid=(\d+)',ss)};owned={x[0] for x in descendants(server.pid,table())}|{server.pid}
   if not listener or not listener.issubset(owned):raise RuntimeError('Listener ownership not proved')
   print('OWNED PREVIEW READY',base,identity,flush=True)
   check=subprocess.Popen(cmd,cwd=R,env=checkenv,start_new_session=True)
   try:return check.wait(timeout=a.timeout)
   except subprocess.TimeoutExpired:raise RuntimeError('Rendered test exceeded bounded timeout')
 finally:
  if check:stop(check)
  if server:stop(server)
  print('Only owned preview/check processes stopped; lease can release.',flush=True)
if __name__=='__main__':raise SystemExit(main())
