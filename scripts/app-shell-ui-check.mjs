// Entire app shell, synthetic/free responses. No external connections or wallet signing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const origin='http://127.0.0.1:5178';
const paths=process.env.UI_PATHS?.split(',')||['portfolio','global','prediction','safety','spot','autopilot','telegram','docs'];
try{
  for(const width of process.env.UI_WIDTHS?.split(',').map(Number)||[360,390,768,1440])for(const theme of process.env.UI_THEMES?.split(',')||['xlayer','base','arbitrum','arc-testnet']){
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin && !/^\/(v1|api|healthz)\b/.test(url.pathname))return route.continue();
      const json=data=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
      if(url.pathname.includes('telegram/status'))return json({configured:false});
      if(url.pathname.includes('instruments'))return json({instruments:[{instId:'BTC-USDT',baseCcy:'BTC',quoteCcy:'USDT'}]});
      return json({});
    });
    for(const path of paths){
      console.log(`CHECK ${path} ${theme} ${width}px`);
      await page.goto(`${origin}/${path}?pulseTheme=${theme}`,{waitUntil:'domcontentloaded'});
      await page.locator('.app .nav').waitFor({timeout:45000}).catch(async error=>{console.error('App state:',(await page.locator('body').innerText()).slice(0,1400),'errors:',errors);throw error;});
      await page.locator('main h1:visible').waitFor().catch(async error=>{console.error('Page state:',(await page.locator('body').innerText()).slice(0,1400),'errors:',errors);throw error;});
      assert.equal(await page.locator('main h1:visible').count(),1,`${path}: one page heading`);
      assert.equal(await page.locator('html').getAttribute('data-pulse-theme'),theme);
      const networkBefore=await page.locator('.network-picker-copy>b').innerText();
      if(path==='portfolio'){
        await page.getByRole('button',{name:'Choose appearance',exact:true}).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.appearance-menu').count(),0);
        assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Choose appearance');
        const alternate=theme==='base'?'Pulse':'Clarity';
        await page.getByRole('button',{name:'Choose appearance',exact:true}).click();
        await page.locator('.appearance-menu button').filter({hasText:alternate}).click();
        assert.equal(await page.locator('html').getAttribute('data-pulse-theme'),theme==='base'?'xlayer':'base');
        assert.equal(await page.locator('.network-picker-copy>b').innerText(),networkBefore);
        if(width<800){
          await page.locator('.mobile-service-trigger').click();
          const first=page.locator('.mobile-service-sheet button').first(),last=page.locator('.mobile-service-sheet button').last();
          await first.focus();await page.keyboard.press('Shift+Tab');assert.equal(await last.evaluate(el=>el===document.activeElement),true);
          await page.keyboard.press('Tab');assert.equal(await first.evaluate(el=>el===document.activeElement),true);
          await page.keyboard.press('Escape');assert.equal(await page.locator('.mobile-service-sheet').count(),0);
        }
      }
      if(path==='docs'){
        assert.equal(await page.locator('.docs-content>[hidden]').count(),16);
        if(width<=800)await page.locator('.docs-mobile-topics select').selectOption('docs-auto');
        else await page.locator('.docs-nav a[href="#docs-auto"]').click();
        await page.locator('#docs-auto:visible').waitFor();
        assert.equal(await page.locator('.docs-content>section:visible').count(),1);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${path} ${theme} ${width}: overflow`);
      assert.deepEqual(errors,[],`${path} ${theme} ${width}: render exceptions`);
    }
    console.log(`PASS app shell ${theme} ${width}px: ${paths.length} routes, one heading, no overflow or render errors`);
    await page.close();
  }
}finally{await browser.close();}
