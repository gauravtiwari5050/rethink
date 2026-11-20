# Builds render/screens.html from the site's own phone-screen CSS and screenshots each screen
# with headless Chrome into render/out/screen-<name>.png (1080x2340), used as the render's display texture.
import os, subprocess
here = os.path.dirname(os.path.abspath(__file__)); site = os.path.dirname(here)
s = open(os.path.join(site, 'index.html')).read()
css = s[s.index('<style>') + 7:s.index('</style>')]
screen_css = css[css.index('.screen {'):css.index('/* app grids for the story */')]
root = css[css.index(':root {'):css.index('}', css.index(':root {')) + 1]
handset = '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>'
html = f'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=block">
<style>{root}
*{{box-sizing:border-box}} html,body{{margin:0;background:#000;width:540px;height:1170px;overflow:hidden}}
{screen_css}
.screen{{border-radius:0!important;height:1170px;width:540px}} .screen::after{{display:none}}
.layer{{transition:none!important}} *{{animation:none!important}}
.screen > .layer {{ opacity:0 }} .screen > .layer.show {{ opacity:1 }}
</style></head><body><div class="screen">
<div class="sb"><span id="t">18:20</span><span>5G ▮▮▮</span></div>
<div class="layer home" id="home">
  <div class="greet">Good evening, Gaurav.<span>Here’s what I handled today.</span></div>
  <div class="orb"></div>
  <div class="hcards">
    <div class="hcard"><b>2 calls answered</b><span>Rahul: dinner moved to Friday. Clinic: Tuesday 4:30 confirmed.</span></div>
    <div class="hcard"><b>WhatsApp · 6 messages</b><span>Nothing urgent. Ma asked if you’re coming Sunday.</span></div>
  </div>
  <div class="ask"><i></i>Ask Rethink anything</div>
</div>
<div class="layer ring" id="ring">
  <div class="avatar">R</div><div class="who">Rahul Mehta</div><div class="sub">mobile · Bengaluru</div>
  <div class="tag">Rethink is answering</div>
  <div class="btns"><span class="btn no">{handset}</span><span class="btn yes">{handset}</span></div>
</div>
</div>
<script>const k=location.hash.slice(1)||'home';document.getElementById(k).classList.add('show');if(k==='ring')document.getElementById('t').textContent='9:41';</script>
</body></html>'''
open(os.path.join(here, 'screens.html'), 'w').write(html)
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for k in ('home', 'ring'):
    subprocess.run([chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=540,1170',
                    '--virtual-time-budget=4000', f'--screenshot={os.path.join(here, "out", f"screen-{k}.png")}', f'file://{os.path.join(here, "screens.html")}#{k}'],
                   stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
print('screens ok')
