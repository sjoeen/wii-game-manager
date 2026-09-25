"""Production-HTML interaction tests with a deliberately simulated filesystem.

The fixture supplies File System Access-shaped handles and permission/lock APIs.
It DOES NOT exercise an OS picker, grant native disk access, or relax browser policy.
Real large disk copies are covered separately by test/large-files.mjs. Loading the
exact built HTML with set_content lets UI tests run even where navigation is blocked.
Requires: pip install playwright; python -m playwright install chromium
CHROMIUM_PATH may select a preinstalled Chromium executable.
"""
import io
import json
import os
import shutil
from pathlib import Path
import tempfile
import unittest
import zipfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text()
FAKE = (ROOT / 'test/fake-fs.mjs').read_text().replace('export class MemoryFS', 'class MemoryFS')
BASE = {
    'apps/loader/boot.dol': 'NOT A REAL HOMEBREW EXECUTABLE',
    'wbfs/Orbit Racers [DEME01]/DEME01.wbfs': 'SYNTHETIC GAME ONE',
    'wbfs/Orbit Racers [DEME01]/DEME01.wbf1': 'SYNTHETIC SPLIT PART',
    'wbfs/Orbit Racers [DEME01]/readme.txt': 'UNRELATED NOTES KEEP ME',
    'wbfs/Star Garden [DEME02]/DEME02.iso': 'SYNTHETIC GAME TWO',
    'config/keep-me.txt': 'ORIGINAL SETTINGS',
    'private/save.dat': 'KEEP THIS SAVE',
}
HOME = {'apps/loader/boot.dol': 'NOT A REAL HOMEBREW EXECUTABLE', 'config/keep-me.txt': 'ORIGINAL SETTINGS'}
PACKAGE = {
    'DemoPack/config/keep-me.txt': 'REPLACEMENT SETTINGS',
    'DemoPack/riivolution/Moonlight.xml': '<wiidisc version="1"><options/></wiidisc>',
    'DemoPack/riivolution/Moonlight/palette.txt': 'SYNTHETIC PATCH',
}

def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for path, data in files.items():
            z.writestr(path, data)
    return out.getvalue()

def payload(name, data, mime='application/octet-stream'):
    return {'name': name, 'mimeType': mime, 'buffer': data.encode() if isinstance(data, str) else data}

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox'])
        cls.version = cls.browser.version
        cls.temp = tempfile.TemporaryDirectory()
        (ROOT / 'screenshots').mkdir(exist_ok=True)
        cls.results = []

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.temp.cleanup()
        dest = ROOT / 'docs/test-results/browser-v3.json'
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps({'browser': cls.version, 'scenarios': cls.results,
            'harness': 'Exact production HTML; Playwright set_content. Filesystem, secure-context feature flag, picker, permissions and Web Locks are test doubles. No native filesystem permission or browser policy was changed.',
            'limits': 'Not native directory picker, hardware SD/Wii, Firefox/Safari or browser memory stress validation.'}, indent=2))

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, reduced_motion='reduce')
        self.page = self.context.new_page(); self.page.set_default_timeout(5000)
        self.errors = []; self.network = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('request', lambda r: self.network.append(r.url) if r.url.startswith(('http://', 'https://')) else None)
        self.page.add_script_tag(content=FAKE)
        self.page.evaluate('''() => {
          // These TEST DOUBLES only make our simulated handles available to the UI.
          Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});
          if (!crypto.randomUUID) crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint32Array(4))).map(n=>n.toString(16)).join('-');
          Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name,options,fn)=>fn(window.testLockHeld?null:{name})}});
          window.pickerCalls=[];window.permissionCalls=[];window.testFS=new MemoryFS({});
          window.showDirectoryPicker=async(options)=>{
            window.pickerCalls.push(options);const root=testFS.root;
            root.requestPermission=async o=>{permissionCalls.push(o);return testFS.permission};
            return root;
          };
        }''')
        self.page.set_content(HTML, wait_until='load')
        expect(self.page.locator('html')).to_have_attribute('data-ready', 'true')

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [], 'Uncaught browser exceptions')
            self.assertEqual(self.network, [], 'Unexpected network requests')
        finally:
            failed = bool(self.errors or self.network) or any(t is self for t, _ in self._outcome.result.failures + self._outcome.result.errors)
            type(self).results.append({'name': self._testMethodName, 'passed': not failed,
                                       'uncaughtErrors': self.errors, 'networkRequests': self.network})
            self.context.close()

    def idle(self):
        expect(self.page.locator('body')).not_to_have_attribute('aria-busy', 'true')
        expect(self.page.locator('#progressDialog')).not_to_be_visible()

    def seed(self, files): self.page.evaluate('(files)=>{window.testFS=new MemoryFS(files)}', files)
    def paths(self): return self.page.evaluate('testFS.paths()')
    def text(self, path): return self.page.evaluate('(path)=>testFS.text(path)', path)
    def snapshot(self, name): self.page.screenshot(path=str(ROOT / 'screenshots' / name), full_page=True)

    def folder(self, files=BASE, selector='#dropZone'):
        self.seed(files); self.page.locator(selector).click()
        expect(self.page.locator('#managerView')).to_be_visible(); self.idle()

    def zip(self, files=BASE):
        self.page.locator('#zipInput').set_input_files(payload('Test-SD.zip', zip_bytes(files), 'application/zip'))
        expect(self.page.locator('#managerView')).to_be_visible(); self.idle()

    def stage_game(self, name='New Game [DEME03].wbfs', data='WBFS SYNTHETIC GAME DATA'):
        self.page.locator('#gameInput').set_input_files(payload(name, data)); self.idle()

    def stage_remove(self, title='Orbit Racers'):
        self.page.get_by_role('button', name=f'Remove {title}', exact=True).click()
        expect(self.page.locator('#confirmDialog')).to_be_visible()
        self.page.locator('#confirmActions').get_by_role('button', name='Remove', exact=True).click(); self.idle()

    def apply(self, expect_dialog='#operationDialog'):
        self.page.locator('#exportBtn').click()
        expect(self.page.locator('#applyDialog')).to_be_visible()
        self.page.locator('#applyAcknowledge').check()
        self.page.locator('#applyConfirmBtn').click()
        expect(self.page.locator(expect_dialog)).to_be_visible(); self.idle()

    def close_operation(self): self.page.locator('#operationDialog [data-close]').last.click()
    def close_error(self): self.page.locator('#errorDialog [data-close]').last.click()

    def add_package(self):
        self.page.locator('#hacksTab').click()
        self.page.locator('#hackInput').set_input_files(payload('Moonlight.zip', zip_bytes(PACKAGE), 'application/zip'))
        expect(self.page.locator('#hackDialog')).to_be_visible()
        self.page.locator('#hackName').fill('Moonlight Test')
        self.page.locator('#confirmHack').click(); self.idle()
        expect(self.page.locator('#hackDialog')).not_to_be_visible()

    def download_zip(self):
        with self.page.expect_download() as event: self.page.locator('#exportBtn').click()
        download=event.value;self.assertIsNone(download.failure())
        p=Path(self.temp.name) / f'{self._testMethodName}.zip'; download.save_as(p)
        self.idle()
        with zipfile.ZipFile(p) as z:
            self.assertIsNone(z.testzip())
            data={f.filename:z.read(f) for f in z.infolist() if not f.is_dir()}
        return data,p

    def test_01_menu_two_channels_no_blank_creator(self):
        expect(self.page.locator('#channelPage1 .channel')).to_have_count(12)
        expect(self.page.locator('#channelPage1 button')).to_have_count(2)
        expect(self.page.locator('#dropZone')).to_contain_text('Open SD / USB')
        expect(self.page.locator('#startEmptyBtn')).to_have_count(0)
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth>innerWidth'))
        self.snapshot('desktop-menu.png')

    def test_02_info_all_exit_paths_restore_focus(self):
        for target in ['#infoCloseBtn','#infoMenuBtn','#infoGotItBtn','Escape','backdrop']:
            self.page.locator('#infoChannel').click()
            expect(self.page.locator('#infoDialog')).to_be_visible()
            if target=='Escape': self.page.keyboard.press('Escape')
            elif target=='backdrop': self.page.mouse.click(2,2)
            else: self.page.locator(target).click()
            expect(self.page.locator('#infoDialog')).not_to_be_visible()
            expect(self.page.locator('#infoChannel')).to_be_focused()
        self.page.locator('#infoChannel').click(); self.snapshot('information-desktop.png')

    def test_03_info_keyboard_focus_trap(self):
        self.page.locator('#infoChannel').click()
        self.page.locator('#infoGotItBtn').focus(); self.page.keyboard.press('Tab')
        expect(self.page.locator('#infoCloseBtn')).to_be_focused()
        self.page.keyboard.press('Shift+Tab');expect(self.page.locator('#infoGotItBtn')).to_be_focused()

    def test_04_menu_pages_and_return(self):
        for number in [2,3,4]:
            self.page.locator('#nextPage').click()
            expect(self.page.locator(f'#channelPage{number}')).to_be_visible()
        expect(self.page.locator('#nextPage')).not_to_be_visible()
        self.page.locator('#wiiMenuButton').click();expect(self.page.locator('#channelPage1')).to_be_visible()
        self.page.keyboard.press('ArrowRight');expect(self.page.locator('#channelPage2')).to_be_visible()
        self.page.keyboard.press('ArrowLeft');expect(self.page.locator('#channelPage1')).to_be_visible()

    def test_05_folder_inventory_is_read_only(self):
        self.folder()
        expect(self.page.locator('#gameCount')).to_have_text('2')
        self.assertEqual(self.page.evaluate('testFS.readBytes'),0)
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)
        self.assertEqual(self.page.evaluate('pickerCalls'),[{'id':'wii-card-root','mode':'read'}])
        self.assertEqual(self.page.evaluate('permissionCalls'),[])
        expect(self.page.locator('#exportBtn')).to_be_disabled()
        self.snapshot('folder-library-desktop.png')

    def test_06_existing_homebrew_card_without_games(self):
        self.folder(HOME)
        expect(self.page.locator('#gameCount')).to_have_text('0')
        expect(self.page.locator('[data-library-action="add-game"]')).to_be_visible()
        self.assertEqual(self.paths(), sorted(HOME))
        self.snapshot('folder-homebrew-no-games.png')
        self.stage_game();expect(self.page.locator('#gameCount')).to_have_text('1')
        self.assertEqual(self.paths(),sorted(HOME))

    def test_07_blank_folder_is_not_an_installer(self):
        self.seed({});self.page.locator('#dropZone').click()
        expect(self.page.locator('#errorDialog')).to_be_visible();self.idle()
        expect(self.page.locator('#errorText')).to_contain_text('does not install homebrew')
        expect(self.page.locator('#managerView')).not_to_be_visible()

    def test_08_wrong_parent_folder_help(self):
        self.seed({'backup/apps/app/boot.dol':'x'});self.page.locator('#dropZone').click()
        expect(self.page.locator('#errorText')).to_contain_text('root containing')
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_09_unsupported_browser_explains_fallback(self):
        self.page.evaluate('delete window.showDirectoryPicker')
        self.page.locator('#dropZone').click()
        expect(self.page.locator('#errorText')).to_contain_text('Open small ZIP instead')
        self.close_error();self.zip(HOME)
        expect(self.page.locator('#exportBtn')).to_have_text('Export ZIP')

    def test_10_picker_cancel_is_quiet(self):
        self.page.evaluate("()=>{window.showDirectoryPicker=async()=>{throw new DOMException('cancel','AbortError')}}")
        self.page.locator('#dropZone').click();self.idle()
        expect(self.page.locator('#errorDialog')).not_to_be_visible()
        expect(self.page.locator('#dropView')).to_be_visible()

    def test_11_sd_footer_opens_folder(self): self.folder(HOME, '#sdButton')

    def test_12_stage_add_review_acknowledge_cancel(self):
        self.folder(HOME);self.stage_game()
        expect(self.page.locator('#pendingPanel')).to_be_visible()
        expect(self.page.locator('#dirtyBadge')).to_have_text('Pending · not applied')
        self.page.locator('#reviewChangesBtn').click()
        expect(self.page.locator('#applyConfirmBtn')).to_be_disabled()
        expect(self.page.locator('#applyPaths')).to_contain_text('DEME03.wbfs')
        self.snapshot('review-changes.png')
        self.page.locator('#applyDialog').get_by_role('button',name='Not now').click()
        self.assertEqual(self.paths(),sorted(HOME));self.assertEqual(self.page.evaluate('testFS.writes.length'),0)
        expect(self.page.locator('#pendingPanel')).to_be_visible()

    def test_13_apply_add_verifies_and_clears_pending(self):
        self.folder(HOME);self.stage_game();self.apply()
        expect(self.page.locator('#operationTitle')).to_have_text('Reviewed changes applied')
        self.assertIn('wbfs/New Game [DEME03]/DEME03.wbfs',self.paths())
        self.assertEqual(self.text('wbfs/New Game [DEME03]/DEME03.wbfs'),'WBFS SYNTHETIC GAME DATA')
        self.assertEqual(self.text('config/keep-me.txt'),HOME['config/keep-me.txt'])
        self.assertEqual(self.page.evaluate('permissionCalls'),[{'mode':'readwrite'}])
        expect(self.page.locator('#pendingPanel')).not_to_be_visible()
        expect(self.page.locator('#undoBtn')).to_be_disabled()
        self.snapshot('folder-operation-complete.png')

    def test_14_operation_report_download(self):
        self.folder(HOME);self.stage_game();self.apply()
        with self.page.expect_download() as event:self.page.locator('#saveOperationBtn').click()
        p=Path(self.temp.name)/'report.json';event.value.save_as(p)
        report=json.loads(p.read_text())
        self.assertEqual(report['result']['status'],'completed')
        self.assertEqual(len(report['reviewed']['writes']),1)

    def test_15_safe_remove_preserves_notes_and_saves(self):
        self.folder();self.stage_remove()
        self.assertEqual(self.paths(),sorted(BASE))
        self.apply()
        self.assertNotIn('wbfs/Orbit Racers [DEME01]/DEME01.wbfs',self.paths())
        self.assertNotIn('wbfs/Orbit Racers [DEME01]/DEME01.wbf1',self.paths())
        self.assertEqual(self.text('wbfs/Orbit Racers [DEME01]/readme.txt'),BASE['wbfs/Orbit Racers [DEME01]/readme.txt'])
        self.assertEqual(self.text('private/save.dat'),'KEEP THIS SAVE')
        expect(self.page.locator('#gameCount')).to_have_text('1')

    def test_16_undo_removal_before_apply(self):
        self.folder();self.stage_remove()
        self.page.locator('#undoBtn').click();self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('2')
        expect(self.page.locator('#pendingPanel')).not_to_be_visible()
        self.assertEqual(self.paths(),sorted(BASE));self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_17_discard_staged_edits_refreshes(self):
        self.folder(HOME);self.stage_game();self.page.locator('#discardEditsBtn').click()
        self.page.locator('#confirmActions').get_by_role('button',name='Discard & refresh').click();self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('0')
        self.assertEqual(self.paths(),sorted(HOME))

    def test_18_search_resets_only_after_success(self):
        self.folder();self.page.locator('#searchInput').fill('zz no results')
        self.stage_game();expect(self.page.locator('#searchInput')).to_have_value('')
        expect(self.page.locator('#content')).to_contain_text('New Game')

    def test_19_duplicate_game_is_not_overwritten(self):
        self.folder();self.stage_game('Duplicate [DEME01].wbfs')
        expect(self.page.locator('#errorText')).to_contain_text('already')
        self.assertEqual(self.paths(),sorted(BASE));expect(self.page.locator('#gameCount')).to_have_text('2')

    def test_20_missing_split_companion_main_rejected(self):
        self.folder();self.stage_game('Missing.wbf1','part')
        expect(self.page.locator('#errorDialog')).to_be_visible()
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_21_correct_split_set_staged_as_one_game(self):
        self.folder(HOME)
        self.page.locator('#gameInput').set_input_files([payload('New [DEME03].wbfs','WBFS head'),payload('New [DEME03].wbf1','tail')]);self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('1')
        expect(self.page.locator('#content .card')).to_contain_text('2 files')
        self.apply();self.assertEqual(self.text('wbfs/New [DEME03]/DEME03.wbf1'),'tail')

    def test_22_permission_denied_no_writes(self):
        self.folder(HOME);self.stage_game();self.page.evaluate("testFS.permission='denied'")
        self.apply('#errorDialog');expect(self.page.locator('#errorText')).to_contain_text('Write permission was not granted')
        expect(self.page.locator('#pendingPanel')).to_be_visible();self.assertEqual(self.paths(),sorted(HOME))

    def test_23_quota_failure_rolls_back_and_skips_removals(self):
        self.folder();self.stage_remove();self.stage_game()
        self.page.evaluate("testFS.hook=(event,path)=>{if(event==='write'&&path.endsWith('DEME03.wbfs'))throw new DOMException('full','QuotaExceededError')}")
        self.apply();expect(self.page.locator('#operationTitle')).to_have_text('Write failed and was rolled back')
        self.assertEqual(self.paths(),sorted(BASE))
        expect(self.page.locator('#operationText')).to_contain_text('Not enough free space')

    def test_24_cancel_copy_rolls_back(self):
        self.folder(HOME);self.stage_game(data=b'WBFS'+b'X'*(5*1024*1024))
        self.page.evaluate("testFS.hook=(event,path)=>{if(event==='write'&&path.endsWith('DEME03.wbfs'))document.getElementById('cancelCopyBtn').click()}")
        self.apply();expect(self.page.locator('#operationTitle')).to_have_text('Copy cancelled and rolled back')
        self.assertEqual(self.paths(),sorted(HOME))

    def test_25_outside_file_change_preflight(self):
        self.folder(HOME);self.stage_game();self.page.evaluate("testFS.seed('config/keep-me.txt','OUTSIDE CHANGE')")
        self.apply('#errorDialog');expect(self.page.locator('#errorText')).to_contain_text('changed')
        self.assertEqual(self.text('config/keep-me.txt'),'OUTSIDE CHANGE')
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_26_other_tab_lock_refuses_apply(self):
        self.folder(HOME);self.stage_game();self.page.evaluate('window.testLockHeld=true')
        self.apply('#errorDialog');expect(self.page.locator('#errorText')).to_contain_text('Another tab')
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_27_drive_loss_reopen_review_recovery(self):
        self.folder(HOME);self.stage_game()
        self.page.evaluate("testFS.hook=(event,path)=>{if(event==='closed'&&path.endsWith('DEME03.wbfs'))testFS.online=false}")
        self.apply('#errorDialog');expect(self.page.locator('#errorText')).to_contain_text('Reconnect')
        expect(self.page.locator('#addBtn')).to_be_disabled();self.close_error()
        self.page.evaluate('testFS.online=true;testFS.hook=()=>{}')
        self.page.locator('#refreshFolderBtn').click();self.idle()
        expect(self.page.locator('#recoveryPanel')).to_be_visible()
        self.page.locator('#recoveryBtn').click();expect(self.page.locator('#recoveryDialog')).to_be_visible()
        self.snapshot('recovery-review.png')
        self.page.locator('#recoveryConfirmBtn').click();self.idle()
        expect(self.page.locator('#recoveryPanel')).not_to_be_visible()
        self.assertEqual(self.paths(),sorted(HOME))

    def test_28_24_gib_inventory_no_game_content_reads(self):
        entries=dict(HOME)
        for i in range(8): entries[f'wbfs/Game {i} [TEST0{i}]/TEST0{i}.wbfs']={'virtualSize':3*1024**3,'header':'WBFS'}
        self.folder(entries);expect(self.page.locator('#gameCount')).to_have_text('8')
        expect(self.page.locator('#archiveStats')).to_contain_text('24.0 GiB')
        self.assertEqual(self.page.evaluate('testFS.readBytes'),0)
        self.snapshot('folder-large-library.png')

    def test_29_oversized_wbfs_plans_three_parts_without_loading(self):
        self.folder(HOME)
        self.page.evaluate('''() => {
          const f={name:'Big Game [DEME03].wbfs',size:5*1024**3,
            slice:(start,end)=>new Blob([start===0?'WBFS':''])};
          const input=document.getElementById('gameInput');
          Object.defineProperty(input,'files',{configurable:true,value:[f]});input.dispatchEvent(new Event('change'));
        }''');self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('1')
        self.page.locator('#exportBtn').click()
        expect(self.page.locator('#applyPaths')).to_contain_text('DEME03.wbf2')
        expect(self.page.locator('#applyPaths')).to_contain_text('2.0 GiB')
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)
        self.snapshot('large-wbfs-review.png')

    def test_30_large_iso_clear_explanation(self):
        self.folder(HOME)
        self.page.evaluate('''() => { const f={name:'Big.iso',size:5*1024**3};const i=document.getElementById('gameInput');Object.defineProperty(i,'files',{value:[f],configurable:true});i.dispatchEvent(new Event('change')); }''');self.idle()
        expect(self.page.locator('#errorText')).to_contain_text('does not convert ISO to WBFS')
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_31_hack_apply_then_remove_restores_settings(self):
        self.folder(HOME);self.add_package()
        self.assertEqual(self.text('config/keep-me.txt'),'ORIGINAL SETTINGS')
        self.apply();self.close_operation()
        self.assertEqual(self.text('config/keep-me.txt'),'REPLACEMENT SETTINGS')
        self.page.locator('#hacksTab').click();self.stage_remove('Moonlight Test')
        self.apply()
        self.assertEqual(self.text('config/keep-me.txt'),'ORIGINAL SETTINGS')
        self.assertEqual(self.paths(),sorted(HOME))

    def test_32_info_from_library_does_not_lose_pending(self):
        self.folder(HOME);self.stage_game();self.page.locator('#managerInfoBtn').click()
        expect(self.page.locator('#infoMenuBtn')).to_have_text('Back to manager')
        expect(self.page.locator('#demoBtn')).to_be_disabled()
        self.page.locator('#infoMenuBtn').click()
        expect(self.page.locator('#gameCount')).to_have_text('1')
        expect(self.page.locator('#pendingPanel')).to_be_visible()

    def test_33_all_files_readonly_and_search(self):
        self.folder();self.page.locator('#filesTab').click()
        expect(self.page.locator('#addBtn')).not_to_be_visible()
        self.page.locator('#searchInput').fill('private/save')
        expect(self.page.locator('.file-row')).to_have_count(1)
        expect(self.page.locator('#content [data-remove]')).to_have_count(0)

    def test_34_small_zip_import_edit_export_independent_bytes(self):
        self.zip();self.stage_remove();self.stage_game()
        data,_=self.download_zip()
        self.assertNotIn('wbfs/Orbit Racers [DEME01]/DEME01.wbfs',data)
        self.assertEqual(data['config/keep-me.txt'],b'ORIGINAL SETTINGS')
        self.assertEqual(data['wbfs/Orbit Racers [DEME01]/readme.txt'],b'UNRELATED NOTES KEEP ME')
        self.assertEqual(data['wbfs/New Game [DEME03]/DEME03.wbfs'],b'WBFS SYNTHETIC GAME DATA')
        expect(self.page.locator('#exportDialog')).to_be_visible()

    def test_35_zip_roundtrip_reimport(self):
        self.zip(HOME);self.stage_game();data,p=self.download_zip()
        self.page.locator('#exportDialog [data-close]').last.click()
        self.page.locator('#newArchiveBtn').click();self.idle()
        if self.page.locator('#confirmDialog').is_visible():
            self.page.locator('#confirmActions button').last.click();self.idle()
        self.page.locator('#zipInput').set_input_files(str(p))
        expect(self.page.locator('#managerView')).to_be_visible();self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('1')

    def test_36_zip_homebrew_zero_games_works_blank_zip_refused(self):
        self.page.locator('#zipInput').set_input_files(payload('Empty.zip',zip_bytes({}),'application/zip'));self.idle()
        expect(self.page.locator('#errorText')).to_contain_text('blank-card')
        self.close_error();self.zip(HOME);expect(self.page.locator('#gameCount')).to_have_text('0')

    def test_37_wrong_upload_format_actionable(self):
        self.page.locator('#zipInput').set_input_files(payload('wrong.rar',b'NOT ZIP'));self.idle()
        expect(self.page.locator('#errorText')).to_contain_text('.zip')
        self.close_error();self.folder(HOME);self.stage_game('wrong.zip',b'not game')
        expect(self.page.locator('#errorText')).to_contain_text('.wbfs')

    def test_38_dangerous_zip_paths_rejected(self):
        self.page.locator('#zipInput').set_input_files(payload('bad.zip',zip_bytes({'../apps/evil':'x'}),'application/zip'));self.idle()
        expect(self.page.locator('#errorDialog')).to_be_visible()
        expect(self.page.locator('#managerView')).not_to_be_visible()

    def test_39_requirements_help_actions(self):
        self.page.locator('#landingUploadHelp').click()
        expect(self.page.locator('#uploadHelpTitle')).to_contain_text('folder')
        expect(self.page.locator('#uploadHelpChooseBtn')).to_contain_text('folder')
        self.page.locator('#uploadHelpDialog [data-close]').last.click()
        self.folder(HOME);self.page.locator('#libraryUploadHelp').click()
        expect(self.page.locator('#uploadHelpSections')).to_contain_text('.wbf1')
        self.page.locator('#uploadHelpDialog [data-close]').last.click()
        self.page.locator('#hacksTab').click();self.page.locator('#libraryUploadHelp').click()
        expect(self.page.locator('#uploadHelpSections')).to_contain_text('256 MiB')

    def test_40_mobile_menu_info_scroll_and_exit(self):
        for width in [360,390,414]:
            self.page.set_viewport_size({'width':width,'height':844})
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth>innerWidth'))
            self.page.locator('#infoChannel').click()
            self.page.locator('#infoDialog .dialog-body').evaluate('(e)=>{e.scrollTop=e.scrollHeight}')
            expect(self.page.locator('#infoGotItBtn')).to_be_in_viewport()
            if width==390:self.snapshot('information-mobile.png')
            self.page.locator('#infoGotItBtn').click()
            expect(self.page.locator('#infoDialog')).not_to_be_visible()
        self.page.set_viewport_size({'width':390,'height':844});self.snapshot('mobile-menu.png')

    def test_41_mobile_folder_preview_and_apply_layout(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.folder(HOME,'#previewOpen');self.stage_game()
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth>innerWidth'))
        self.snapshot('folder-mobile.png')
        self.page.locator('#exportBtn').click()
        self.page.locator('#applyDialog .dialog-body').evaluate('(e)=>e.scrollTop=e.scrollHeight')
        self.page.locator('#applyAcknowledge').check()
        expect(self.page.locator('#applyConfirmBtn')).to_be_in_viewport()
        self.snapshot('review-mobile.png')
        self.page.locator('#applyConfirmBtn').click();self.idle()
        expect(self.page.locator('#operationTitle')).to_have_text('Reviewed changes applied')

    def test_42_zip_drag_drop(self):
        data=list(zip_bytes(HOME))
        self.page.evaluate('''bytes=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],'Homebrew.zip',{type:'application/zip'}));document.getElementById('dropView').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));}''',data)
        expect(self.page.locator('#managerView')).to_be_visible();self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('0')

    def test_43_demo_is_nonplayable_zip_not_empty_creator(self):
        self.page.locator('#infoChannel').click();self.page.locator('#demoBtn').click();self.idle()
        expect(self.page.locator('#gameCount')).to_have_text('2')
        expect(self.page.locator('#demoNotice')).to_be_visible()
        expect(self.page.locator('#exportBtn')).to_have_text('Export ZIP')

    def test_44_last_game_removal_keeps_existing_homebrew_setup(self):
        self.folder({**HOME,'wbfs/Only [DEME01]/DEME01.wbfs':'WBFS only'})
        self.stage_remove('Only');self.apply();self.close_operation()
        expect(self.page.locator('#gameCount')).to_have_text('0')
        expect(self.page.locator('[data-library-action="add-game"]')).to_be_visible()
        self.assertEqual(self.paths(),sorted(HOME))

    def test_45_large_mod_package_refused_before_load(self):
        self.folder(HOME);self.page.locator('#hacksTab').click()
        self.page.evaluate('''()=>{const i=document.getElementById('hackInput');Object.defineProperty(i,'files',{value:[{name:'Huge.zip',size:300*1024**2}],configurable:true});i.dispatchEvent(new Event('change'));}''');self.idle()
        expect(self.page.locator('#errorText')).to_contain_text('256 MiB')
        self.assertEqual(self.page.evaluate('testFS.writes.length'),0)

    def test_46_xss_in_filename_remains_text(self):
        self.zip({**HOME,'wbfs/<img onerror=alert(1)> [DEME01]/DEME01.wbfs':'WBFS'})
        expect(self.page.locator('#content img')).to_have_count(0)
        expect(self.page.locator('#content h3')).to_contain_text('<img')

if __name__ == '__main__': unittest.main(verbosity=2)
