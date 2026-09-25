"""Actual browser launch probe, without simulated APIs or policy changes.
Exit 0: both launch modes checked. Exit 2: a mode blocked by administrator.
Other failures exit 1. This tests startup/API exposure, not the native OS picker.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
with socket.socket() as s:
    s.bind(('127.0.0.1',0));port=s.getsockname()[1]
server=subprocess.Popen(['node','scripts/serve.mjs','--port',str(port),'--base','/wii-game-manager/'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
results=[]
try:
    for _ in range(100):
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.1):break
        except OSError:time.sleep(.05)
    else:raise RuntimeError('Local preview server did not start')
    with sync_playwright() as pw:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
        browser=pw.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox'])
        for kind,url in [('project-http',f'http://127.0.0.1:{port}/wii-game-manager/'),('portable-file',(ROOT/'Wii-SD-Manager.html').as_uri())]:
            page=browser.new_page()
            try:
                page.goto(url,wait_until='load',timeout=10000)
                expect(page.locator('html')).to_have_attribute('data-ready','true')
                page.locator('#infoChannel').click();page.locator('#infoGotItBtn').click()
                expect(page.locator('#infoDialog')).not_to_be_visible()
                capabilities=page.evaluate('({secure:window.isSecureContext,directoryPicker:typeof showDirectoryPicker==="function",locks:!!navigator.locks})')
                results.append({'mode':kind,'status':'passed','capabilities':capabilities})
            except Exception as error:
                message=str(error)
                results.append({'mode':kind,'status':'blocked' if 'ERR_BLOCKED_BY_ADMINISTRATOR' in message else 'failed','message':message})
            finally:page.close()
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=3)
    except subprocess.TimeoutExpired:server.kill();server.wait()
report={'tests':results,'note':'Actual navigation with unmodified policy. No native OS directory-picker selection, disk write permission, SD hardware or Wii gameplay exercised.'}
p=ROOT/'docs/test-results/launch-probe.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
raise SystemExit(1 if any(r['status']=='failed' for r in results) else 2 if any(r['status']=='blocked' for r in results) else 0)
