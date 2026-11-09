'use strict';

// Offline synthetic Edge fixtures only. No account/profile, real Zalo URL, or
// live send. Native filechooser is intercepted by Playwright and fed local bytes.
// Run: node scripts/testZaloImageSend.js (installed Microsoft Edge required).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright-core');
const { sendImageOnPage } = require('../utils/zaloImageSend');

function fixture(settings) {
    return `<!doctype html><html lang="vi"><meta charset="utf-8">
<style>
body{margin:16px;font:16px sans-serif}.message-view{height:80px}.chat-box-input-container{padding:12px;border:1px solid #999}
#richInput{min-height:28px}.chat-box-toolbar-button{display:inline-block;width:40px;height:30px;background:#ddd;cursor:pointer}
i{display:inline-block;width:20px;height:20px}img{width:40px;height:40px}button,[role=button],.chat-box-input-button{display:inline-block;padding:8px;margin:8px}
[role=dialog],dialog{position:fixed;top:180px;left:30px;padding:12px;background:#eee}
</style>
<article id="chatView"><div class="message-view"><div class="chat-item me"><img alt="Old avatar">
<div class="message-frame" data-qid="baseline">Old fixture text</div></div></div>
<div class="chat-box-input-container"><div id="richInput" contenteditable="true"></div>
<div class="chat-box-toolbar"><div class="chat-box-toolbar-button"><i class="fa-Photo_24_Line"></i></div></div></div></article>
<script>
window.settings=${JSON.stringify(settings)};
window.photoClicks=0;window.uploads=0;window.sendClicks=0;window.enters=0;window.inputEvents=0;window.target='fixture-contact';
window.addOutgoing=(image=true,id='new-outgoing')=>{
 const row=document.createElement('div');row.className='chat-item me';
 const avatar=document.createElement('img');avatar.alt='New avatar';row.append(avatar);
 const frame=document.createElement('div');frame.className='message-frame';frame.setAttribute('data-qid',id);
 if(image){const img=document.createElement('img');img.alt='Outgoing fixture';img.src=settings.echoWrong?settings.other:(window.outgoingSource||'');frame.append(img);}else frame.textContent='Unknown outgoing content';
 if(settings.receipt!==null){const receipt=document.createElement('div');receipt.className='card-send-time';receipt.textContent=settings.receipt??'10:12 Đã gửi';if(settings.hiddenReceipt)receipt.style.display='none';frame.append(receipt);}
 row.append(frame);document.querySelector('.message-view').append(row);return row;
};
document.addEventListener('keydown',event=>{if(event.key==='Enter')window.enters++;});
document.querySelector('#richInput').addEventListener('input',()=>{window.inputEvents++;if(settings.captionAutosend)addOutgoing();});
document.querySelector('.chat-box-toolbar-button').addEventListener('click',()=>{
 window.photoClicks++;
 if(settings.menu){const menu=document.createElement('div');menu.setAttribute('role','menu');menu.textContent='Unknown menu';document.body.append(menu);return;}
 const input=document.createElement('input');input.type='file';input.accept='image/*';input.hidden=true;document.body.append(input);
 input.addEventListener('change',async()=>{
  if(!input.files.length)return; // A canceled native picker is not an upload.
  window.uploads++;
  window.outgoingSource=URL.createObjectURL(input.files[0]);
  if(settings.autosend){const row=addOutgoing(!settings.avatarOnly);if(settings.transient)row.remove();return;}
  if(settings.uncertain){addOutgoing(false);return;}
  if(settings.removeBaseline)document.querySelector('.chat-item.me').remove();
  if(settings.noPreview)return;
  const scope=settings.dialog?document.createElement(settings.dialogTag||'div'):document.querySelector('.chat-box-input-container');
  if(settings.dialog){if(settings.dialogTag==='dialog')scope.setAttribute('open','');else scope.setAttribute('role','dialog');document.body.append(scope);}
  const img=document.createElement('img');img.alt='Local fixture preview';
  img.src=settings.wrong?settings.other:(settings.data?await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(input.files[0]);}):URL.createObjectURL(input.files[0]));
  scope.append(img);
  const tag=settings.buttonTag||'button';const button=document.createElement(tag);
  if(tag==='div')button.setAttribute('role','button');
  if(settings.observedButton){button.removeAttribute('role');button.className='chat-box-input-button';}
  if(settings.labelAttribute)button.setAttribute(settings.labelAttribute,settings.label||'Gửi');else button.textContent=settings.label||'Gửi';
  button.onclick=()=>{window.sendClicks++;window.sentCaption=document.querySelector('#richInput').textContent;
     if(settings.noEcho)return;
     const row=addOutgoing();
     if(window.sentCaption){const text=document.createElement('span');text.className='message-action';text.textContent=window.sentCaption;row.querySelector('.message-frame').append(text);}
     if(settings.duplicateEcho)addOutgoing(true,'second-outgoing');
     if(settings.wrongPeer)window.target='other-contact';
        if(settings.peerRoundTrip){const editor=document.querySelector('#richInput');editor.setAttribute('data-trailer','Other contact');editor.removeAttribute('data-trailer');}
        if(settings.rootRoundTrip){const root=document.querySelector('#chatView');root.remove();document.body.append(root);}
     if(!settings.keepDraft)document.querySelector('#richInput').textContent='';
     img.remove();button.remove();
    };
  if(settings.disabledSend)button.setAttribute('aria-disabled','true');
  if(!settings.noSend)scope.append(button);
  if(settings.duplicateSend)scope.append(button.cloneNode(true));
  if(settings.secondImage){const second=img.cloneNode();if(settings.hiddenSecondImage)second.style.display='none';scope.append(second);}
  if(settings.responsive)img.srcset=img.src+' 1x';
  if(settings.secondDialog){const other=document.createElement('div');other.setAttribute('role','dialog');other.textContent='Other dialog';document.body.append(other);}
 });
 input.click();
});
</script></html>`;
}

(async () => {
    assert.deepEqual(Object.keys(require('../utils/zaloImageSend')), ['sendImageOnPage']);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1000, height: 700 } });
    const requests = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    // Inspect real polling results, without catching predicate rejections or
    // suppressing browser errors. This makes the error-envelope regression
    // deterministic even when an idle Edge run emits no unhandled rejection.
    const readinessErrors = [];
    const waitForFunction = page.waitForFunction.bind(page);
    page.waitForFunction = async (...args) => {
        const result = await waitForFunction(...args);
        const status = await result.jsonValue();
        if (status && typeof status.error === 'string') readinessErrors.push(status.error);
        return result;
    };
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tikoder-image-fixture-'));
    let passed = 0;
    let imagePath, expectedSha256, other;
    const test = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
    const load = async settings => {
        // Fresh JS realm: canceled pickers, FileReaders and prototype overrides
        // from an earlier scenario must not leak into the next fixture.
        await page.goto('about:blank');
        await page.setContent(fixture({ other, ...settings }));
    };
    const counts = () => page.evaluate(() => ({ photo: photoClicks, uploads, sends: sendClicks, enters }));
    const expectCounts = async (photo, uploads, sends) => assert.deepEqual(await counts(), { photo, uploads, sends, enters: 0 });
    const send = (options = {}) => {
        let verification = 0, guards = 0;
        return sendImageOnPage({
            page, imagePath, expectedSha256,
            verifyTarget: async () => {
                verification++;
                assert.equal(await page.evaluate(() => target === 'fixture-contact' && !!document.querySelector('#richInput[contenteditable="true"]')), true, 'Target changed');
                if (options.onVerify) await options.onVerify(verification);
            },
            beforeSend: () => { guards++; if (options.onGuard) return options.onGuard(guards); },
            ...Object.fromEntries(Object.entries(options).filter(([key]) => !['onVerify', 'onGuard'].includes(key)))
        });
    };
    const checkResult = (result, outcome = 'sent') => {
        assert.equal(result.outcome, outcome);
        if (outcome === 'needs_check') assert.match(result.detail, /Delivery cannot be guaranteed/);
    };
    try {
        const images = await page.evaluate(() => ['#bd2929', '#294cbd'].map(color => {
            const canvas = document.createElement('canvas');canvas.width=4;canvas.height=4;
            const drawing=canvas.getContext('2d');drawing.fillStyle=color;drawing.fillRect(0,0,4,4);
            return canvas.toDataURL('image/png');
        }));
        other = images[1];
        const buffer = Buffer.from(images[0].split(',')[1], 'base64');
        imagePath = path.join(directory, 'fixture.png');
        await fs.writeFile(imagePath, buffer);
        expectedSha256 = createHash('sha256').update(buffer).digest('hex');

        await test('Exact blob preview, observed toolbar, one semantic Send and empty-only caption', async () => {
            await load();
            checkResult(await send({ caption: 'Fixture caption' }));
            await expectCounts(1, 1, 1);
            assert.equal(await page.evaluate(() => sentCaption), 'Fixture caption');
            assert.equal(await page.evaluate(() => inputEvents), 1);
        });
        for (const settings of [
            { data: true, label: 'Send photo', buttonTag: 'div' },
            { dialog: true, label: 'Gửi ảnh', labelAttribute: 'title' },
            { dialog: true, dialogTag: 'dialog', label: 'Send', labelAttribute: 'aria-label', buttonTag: 'div' },
            { observedButton: true, buttonTag: 'div', label: 'Gửi' }
        ]) await test(`Exact local preview supports semantic variant ${JSON.stringify(settings)}`, async () => {
            await load(settings);checkResult(await send());await expectCounts(1, 1, 1);
        });
        for (const settings of [{ echoWrong:true }, { noEcho:true }, { duplicateEcho:true }, { wrongPeer:true }, { peerRoundTrip:true }, { rootRoundTrip:true }, { keepDraft:true }]) {
            await test('Unresolved outgoing proof never confirms or retries ' + JSON.stringify(settings), async () => {
                await load(settings);
                checkResult(await send({ caption:'Fixture caption' }), 'needs_check');
                await expectCounts(1, 1, 1);
            });
        }
        await test('Exact auto-send echo confirms without a second send', async () => {
            await load({ autosend:true });checkResult(await send());await expectCounts(1, 1, 0);
        });
        for (const receipt of ['Đã gửi', 'Đã nhận 10:12', '10:12 Đã xem']) {
            await test('Positive image receipt: ' + receipt, async () => {
                await load({ receipt });checkResult(await send());await expectCounts(1, 1, 1);
            });
        }
        for (const receipt of ['10:12 Đang gửi', '10:12 Gửi thất bại', '10:12', '', null, '10:12 Không rõ', 'Đã gửi Gửi thất bại']) {
            await test('Image echo without positive acceptance: ' + JSON.stringify(receipt), async () => {
                await load({ receipt });checkResult(await send(), 'needs_check');await expectCounts(1, 1, 1);
            });
        }
        for (const receipt of ['Đang gửi', 'Gửi thất bại', null]) {
            await test('Auto-send without positive acceptance never retries: ' + JSON.stringify(receipt), async () => {
                await load({ autosend:true, receipt });checkResult(await send(), 'needs_check');await expectCounts(1, 1, 0);
            });
        }
        await test('Pending auto-sent image waits for positive acceptance without a second send', async () => {
            await load({ autosend:true, receipt:'Đang gửi' });
            const result = await send({ onVerify:async count => {

                if(count===3)await page.evaluate(()=>{
                    setTimeout(()=>{document.querySelector('[data-qid="new-outgoing"] .card-send-time').textContent='10:12 Đã xem';},100);
                });
            } });

            checkResult(result);
            await expectCounts(1, 1, 0);
        });
        await test('Hidden image receipt is not positive acceptance', async () => {
            await load({ hiddenReceipt:true });checkResult(await send(), 'needs_check');await expectCounts(1, 1, 1);
        });
        await test('Image acceptance is rechecked after final awaited target verification', async () => {
            await load();
            checkResult(await send({ onVerify:async count => {
                if(count===5)await page.evaluate(()=>{document.querySelector('[data-qid="new-outgoing"] .card-send-time').textContent='Gửi thất bại';});
            } }), 'needs_check');
            await expectCounts(1, 1, 1);
        });
        await test('Original source digest mismatch stops before any browser action', async () => {
            await load();await assert.rejects(send({ expectedSha256: '0'.repeat(64) }), /source SHA256 mismatch/);await expectCounts(0, 0, 0);
        });
        for (const value of [undefined, '', 'not-a-digest']) await test('Expected SHA256 is mandatory', async () => {
            await load();await assert.rejects(send({ expectedSha256: value }), /expected SHA256/);await expectCounts(0, 0, 0);
        });
        await test('Wrong/transformed preview digest never fills caption or sends', async () => {
            await load({ wrong: true });
            await assert.rejects(send({ caption: 'Must not be inserted' }), /preview SHA256 mismatch/);
            await expectCounts(1, 1, 0);
            assert.equal(await page.locator('#richInput').textContent(), '');
        });
        await test('Auto-send skips caption and all second send actions', async () => {
            await load({ autosend: true });checkResult(await send({ caption: 'No extra message' }), 'needs_check');await expectCounts(1, 1, 0);
            assert.equal(await page.locator('#richInput').textContent(), '');
            assert.equal(await page.evaluate(() => inputEvents), 0);
        });
        await test('Transient auto-sent row is retained by the outgoing observer', async () => {
            await load({ autosend: true, transient: true });checkResult(await send(), 'needs_check');await expectCounts(1, 1, 0);
        });
        await test('Avatar outside the frame is not outgoing image evidence', async () => {
            await load({ autosend: true, avatarOnly: true });await assert.rejects(send(), /not positively an image/);await expectCounts(1, 1, 0);
        });
        await test('Uncertain outgoing IDs abort rather than permit a send', async () => {
            await load();
            await assert.rejects(send({ onVerify: async count => {
                if(count===3)await page.evaluate(()=>{const row=addOutgoing();row.querySelector('.message-frame').removeAttribute('data-qid');});
            } }), /uncertain outgoing IDs|without a reliable ID/);await expectCounts(1, 1, 0);
        });
        await test('Baseline disappearance is ambiguous, never permission to send', async () => {
            await load({ removeBaseline: true });await assert.rejects(send(), /baseline disappeared/);await expectCounts(1, 1, 0);
        });
        for (const [name, settings, pattern] of [
            ['no preview', { noPreview: true }, /no unambiguous new outgoing/],
            ['no semantic Send', { noSend: true }, /exactly one semantic Send/],
            ['unknown label', { label: 'i18n.send_photo' }, /exactly one semantic Send/],
            ['non-exact label', { label: 'Send everything now' }, /exactly one semantic Send/],
            ['duplicate Send', { duplicateSend: true }, /exactly one semantic Send/],
            ['multiple previews', { secondImage: true }, /exactly one NEW preview/],
            ['hidden extra preview', { secondImage: true, hiddenSecondImage: true }, /exactly one NEW preview/],
            ['responsive preview', { responsive: true }, /responsive preview source selection/],
            ['disabled Send', { disabledSend: true }, /Send control is disabled/],
            ['multiple dialogs', { dialog: true, secondDialog: true }, /no unambiguous|multiple visible semantic dialogs/],
            ['new non-image outgoing', { uncertain: true }, /not positively an image/],
            ['unknown photo menu', { menu: true }, /did not open a file chooser/]
        ]) await test(`Fail closed: ${name}`, async () => {
            await load(settings);await assert.rejects(send(), pattern);await expectCounts(1, settings.menu ? 0 : 1, 0);
        });
        await test('No photo control: unrelated persistent file input is never touched', async () => {
            await load();await page.evaluate(()=>{
                document.querySelector('.chat-box-toolbar-button').remove();
                const input=document.createElement('input');input.type='file';input.onchange=()=>window.uploads++;document.body.append(input);
            });
            await assert.rejects(send(), /exactly one visible observed photo/);await expectCounts(0, 0, 0);
        });
        await test('Two visible actual photo controls fail without choosing the first', async () => {
            await load();await page.evaluate(()=>{const node=document.querySelector('.chat-box-toolbar-button');node.after(node.cloneNode(true));});
            await assert.rejects(send(), /exactly one visible observed photo/);await expectCounts(0, 0, 0);
        });
        await test('Hidden duplicate photo control is not selected', async () => {
            await load();await page.evaluate(()=>{const node=document.querySelector('.chat-box-toolbar-button').cloneNode(true);node.hidden=true;node.style.display='none';document.querySelector('.chat-box-toolbar').append(node);});
            checkResult(await send());await expectCounts(1, 1, 1);
        });
        for (const [name, mutate] of [
            ['text draft', ()=>{document.querySelector('#richInput').textContent='User draft';}],
            ['whitespace draft', ()=>{document.querySelector('#richInput').textContent=' ';}],
            ['image attachment', ()=>{const image=document.createElement('img');document.querySelector('.chat-box-input-container').append(image);}],
            ['unknown attachment widget', ()=>{const node=document.createElement('div');node.className='attachment-preview';document.querySelector('.chat-box-input-container').append(node);}],
            ['existing semantic dialog', ()=>{const node=document.createElement('div');node.setAttribute('role','dialog');node.textContent='Existing modal';document.body.append(node);}]
        ]) await test(`Existing ${name} remains untouched`, async () => {
            await load();await page.evaluate(mutate);const before=await page.content();
            await assert.rejects(send(), /draft|dialog/);assert.equal(await page.content(),before);await expectCounts(0, 0, 0);
        });
        for (const boundary of [1, 2, 3]) await test(`Target change aborts at boundary ${boundary} (chooser/upload/send)`, async () => {
            await load();
            await assert.rejects(send({ onVerify: async count => { if(count===boundary)throw new Error('Target changed'); } }), /Target changed/);
            await expectCounts(boundary===1?0:1, boundary===3?1:0, 0);
        });
        for (const boundary of [1, 2, 3]) await test(`Pause/revision guard is rechecked after awaited target at boundary ${boundary}`, async () => {
            await load();let paused=false;
            await assert.rejects(send({ onVerify: async count=>{if(count===boundary)paused=true;}, onGuard:()=>{if(paused)throw new Error('Paused revision');} }), /Paused revision/);
            await expectCounts(boundary===1?0:1, boundary===3?1:0, 0);
        });
        await test('Async beforeSend is rejected and its rejection is consumed', async () => {
            await load();await assert.rejects(send({ beforeSend:()=>Promise.reject(new Error('Do not leak guard data')) }), /beforeSend must be synchronous/);await expectCounts(0, 0, 0);
        });
        await test('False target and guard assertions refuse all actions', async () => {
            await load();await assert.rejects(send({ verifyTarget:async()=>false }), /target verification refused/);await expectCounts(0, 0, 0);
            await load();await assert.rejects(send({ beforeSend:()=>false }), /beforeSend refused/);await expectCounts(0, 0, 0);
        });
        await test('Auto-send racing the final target verification avoids the final click', async () => {
            await load();checkResult(await send({ onVerify:async count=>{if(count===3)await page.evaluate(()=>addOutgoing());} }), 'needs_check');await expectCounts(1, 1, 0);
        });
        await test('Caption input auto-send is never followed by a Send click', async () => {
            await load({ captionAutosend: true });checkResult(await send({ caption:'Fixture caption' }), 'needs_check');await expectCounts(1, 1, 0);
        });
        await test('User draft inserted during final verification is not overwritten or sent', async () => {
            await load();await assert.rejects(send({ caption:'Do not overwrite', onVerify:async count=>{
                if(count===3)await page.evaluate(()=>{document.querySelector('#richInput').textContent='New user draft';});
            } }), /editor draft changed/);await expectCounts(1, 1, 0);
            assert.equal(await page.locator('#richInput').textContent(),'New user draft');
        });
        await test('Preview source change during final verification aborts', async () => {
            await load();await assert.rejects(send({ onVerify:async count=>{
                if(count===3)await page.evaluate(url=>{document.querySelector('.chat-box-input-container img').src=url;},other);
            } }), /verified preview or Send control changed/);await expectCounts(1, 1, 0);
        });
        await test('Send outside the preview scope is not used', async () => {
            await load({ noSend:true });await page.evaluate(()=>{const button=document.createElement('button');button.textContent='Send';button.onclick=()=>window.sendClicks++;document.body.append(button);});
            await assert.rejects(send(), /exactly one semantic Send/);await expectCounts(1, 1, 0);
        });
        await test('Image added to an old outgoing ID is ambiguous, not permission to send', async () => {
            await load();await assert.rejects(send({ onVerify:async count=>{
                if(count===3)await page.evaluate(()=>document.querySelector('.message-frame').append(document.createElement('img')));
            } }), /outgoing detection uncertain.*baseline ID/);await expectCounts(1, 1, 0);
        });
        await test('Duplicate baseline IDs fail before chooser or upload', async () => {
            await load();await page.evaluate(()=>addOutgoing(true,'baseline'));
            await assert.rejects(send(), /uncertain outgoing IDs/);await expectCounts(0, 0, 0);
        });
        await test('Final async guard cannot authorize a Send click', async () => {
            await load();await assert.rejects(send({ onGuard:count=>count===3?Promise.reject(new Error('Async pause')):undefined }), /beforeSend must be synchronous/);
            await expectCounts(1, 1, 0);
        });
        await test('Target is checked again after caption entry, before final Send', async () => {
            await load();await assert.rejects(send({ caption:'Verified fixture caption', onVerify:async count=>{
                if(count===4)throw new Error('Target changed after caption');
            } }), /Target changed after caption/);await expectCounts(1, 1, 0);
        });
        await test('Obscured Send control fails without forcing a click', async () => {
            await load();await assert.rejects(send({ onVerify:async count=>{
                if(count===3)await page.evaluate(()=>{
                    const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;background:#ddd;z-index:100';document.body.append(overlay);
                });
            } }), /Send control is obscured/);await expectCounts(1, 1, 0);
        });
        await test('A setFiles error after auto-send is never retried', async () => {
            await load({ autosend:true });let attempts=0;
            const originalWait=page.waitForEvent;
            page.waitForEvent=async function(name,options){
                const event=await originalWait.call(this,name,options);
                if(name==='filechooser'){
                    const originalSet=event.setFiles.bind(event);
                    event.setFiles=async(...args)=>{attempts++;await originalSet(...args);throw new Error('Ambiguous post-upload failure');};
                }
                return event;
            };
            try { await assert.rejects(send(),/Ambiguous post-upload failure/); }
            finally { page.waitForEvent=originalWait; }
            assert.equal(attempts,1);await expectCounts(1, 1, 0);
        });
        await test('No arbitrary remote URL is fetched to verify a preview', async () => {
            await load();
            // Keep a decoded local image but override its resolved source in this
            // synthetic test. This isolates the verifier from browser img loading.
            await assert.rejects(send({ onVerify:async count=>{
                if(count===2)await page.evaluate(()=>{
                    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'currentSrc');
                    Object.defineProperty(HTMLImageElement.prototype,'currentSrc',{configurable:true,get(){return this.closest('.chat-box-input-container')?'https://invalid.example/remote.png':descriptor.get.call(this);}});
                });
            } }), /not a remote URL/);await expectCounts(1, 1, 0);
        });
        assert.equal(readinessErrors.length, 4, 'All terminal readiness failures must resolve as data before the Node caller rejects');
        for (const [detail, count] of [
            ['new outgoing row is not positively an image', 2],
            ['outgoing baseline disappeared or changed', 1],
            ['multiple visible semantic dialogs', 1]
        ]) assert.equal(readinessErrors.filter(error => error.includes(detail)).length, count, detail);
        assert.deepEqual(requests, [], 'No HTTP requests, profiles, or real-account traffic are allowed');
        assert.deepEqual(pageErrors, [], `No fixture errors: ${JSON.stringify(pageErrors)}`);
        console.log(`\n${passed} offline Edge image-send tests passed. Runtime-conditional DOM echo proof only; authenticated delivery is not verified.`);
    } finally {
        await context.close();await browser.close();await fs.rm(directory,{ recursive:true,force:true });
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
