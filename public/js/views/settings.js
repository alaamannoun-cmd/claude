import { state, director, emit } from '../store.js';
import { api } from '../api.js';
import { av } from '../components.js';
import { esc, icon, toast, pref, setPref, confirmBox, download } from '../ui.js';

export async function render(root) {
  function paint() {
    const c = state.config;
    const p = state.profile;
    const d = director();
    const notif = 'Notification' in window ? Notification.permission : 'unsupported';
    root.innerHTML = `
    <div class="page settings">
      <div class="page-head"><div><h1>${icon('sliders', 26)} الإعدادات</h1><p class="muted">اتصال الذكاء الاصطناعي، ملفك الشخصي، والمظهر.</p></div></div>
      <div class="settings-grid">
        <section class="card set-card">
          <h2>${icon('key', 20)} اتصال DeepSeek</h2>
          <div class="conn ${c.mock ? 'mock' : 'live'}"><i></i><div><b>${c.mock ? 'وضع تجريبي' : 'متصل'}</b><small>${c.mock ? (c.forceMock ? 'مفعّل بـ MOCK=1' : 'لا يوجد مفتاح — الردود توضيحية') : `المفتاح ${esc(c.keyHint)} (${c.keySource === 'env' ? 'من ملف .env' : 'محفوظ بالتطبيق'}) · ${esc(c.model)}`}</small></div></div>
          <form id="keyForm" class="form">
            <label class="field"><span>مفتاح API</span><div class="input-icon">${icon('key', 16)}<input class="input" name="key" type="password" dir="ltr" placeholder="${c.hasKey ? 'الصق مفتاحاً جديداً للاستبدال' : 'sk-…'}" autocomplete="off"></div></label>
            <label class="field"><span>النموذج</span><select class="input" name="model">
              <option value="deepseek-chat" ${c.model === 'deepseek-chat' ? 'selected' : ''}>deepseek-chat — سريع ومتوازن (موصى به)</option>
              <option value="deepseek-reasoner" ${c.model === 'deepseek-reasoner' ? 'selected' : ''}>deepseek-reasoner — تفكير أعمق وأبطأ</option>
            </select></label>
            <div class="row gap wrap">
              <button class="btn primary">${icon('check', 16)} حفظ</button>
              <button type="button" class="btn subtle" id="testBtn">${icon('bolt', 16)} اختبار الاتصال</button>
              ${c.keySource === 'app' ? `<button type="button" class="btn ghost danger" id="clearKey">${icon('trash', 16)} إزالة المفتاح</button>` : ''}
            </div>
          </form>
          <p class="note">${icon('lock', 14)} المفتاح بينحفظ بملف <code>data/config.json</code> على السيرفر المحلي فقط، وما بيوصل للمتصفح أبداً. الطبقة الأمنية الكاملة (تشفير، مستخدمين، حدود استخدام) بالمرحلة الجاية.</p>
        </section>

        <section class="card set-card">
          <h2>${icon('users', 20)} ملفك الشخصي</h2>
          <p class="muted small">هاي المعلومات بيشوفها كل المدرّبين. أمّا اللي بيتعلّمه كل مدرّب عنك، فبينحفظ بذاكرته الخاصة.</p>
          <form id="profForm" class="form">
            <label class="field"><span>الاسم</span><input class="input" name="name" maxlength="40" value="${esc(p.name)}"></label>
            <label class="field"><span>نبذة عنك</span><textarea class="input" name="bio" rows="2" maxlength="600" placeholder="مثال: مهندس كهرباء، مهتم بالطاقة المتجددة وبرمجة الويب">${esc(p.bio)}</textarea></label>
            <label class="field"><span>كيف بتحب تتعلّم؟</span><textarea class="input" name="preferences" rows="2" maxlength="600" placeholder="مثال: أمثلة عملية، شرح مختصر، فيديوهات">${esc(p.preferences)}</textarea></label>
            <button class="btn primary">${icon('check', 16)} حفظ</button>
          </form>
        </section>

        <section class="card set-card">
          <h2>${icon('crown', 20)} مدير المجلس</h2>
          <div class="dir-row">${av(d, 64)}<div><b>${esc(d.name)}</b><small class="muted">${esc(d.title)}</small></div><a class="btn subtle sm" href="#/forge/${d.id}">${icon('edit', 15)} خصّص شخصيته وشكله</a></div>
        </section>

        <section class="card set-card">
          <h2>${icon('sun', 20)} التجربة</h2>
          <label class="toggle"><input type="checkbox" id="soundT" ${pref('sound', true) ? 'checked' : ''}><span></span> مؤثرات صوتية خفيفة</label>
          <label class="toggle"><input type="checkbox" id="themeT" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}><span></span> الوضع الليلي <small class="muted">(اختياري — الافتراضي فاتح ومريح)</small></label>
          <label class="toggle"><input type="checkbox" id="notifT" ${pref('notify', false) && notif === 'granted' ? 'checked' : ''} ${notif === 'unsupported' || notif === 'denied' ? 'disabled' : ''}><span></span> إشعارات تذكير بالأهداف ${notif === 'denied' ? '<small class="muted">(محظورة من المتصفح)</small>' : ''}</label>
        </section>

        <section class="card set-card">
          <h2>${icon('file', 20)} بياناتك</h2>
          <p class="muted small">كل شي محفوظ كملفات مقروءة بمجلد <code>data/</code>: ذاكرة كل مدرّب بـ <code>data/mentors/&lt;id&gt;/memory.md</code>.</p>
          <div class="row gap wrap">
            <button class="btn subtle" id="exportAll">${icon('download', 16)} تصدير كل البيانات (JSON)</button>
            <button class="btn ghost danger" id="resetAll">${icon('trash', 16)} مسح كل شي والبدء من جديد</button>
          </div>
          ${c.protected ? `<button class="btn subtle" id="logoutBtn" style="margin-top:12px">${icon('lock', 16)} تسجيل الخروج</button>` : ''}
        </section>
      </div>
    </div>`;
  }

  root.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.id === 'keyForm') {
        const r = await api.post('/api/config', { apiKey: f.key.value.trim() || undefined, model: f.model.value });
        state.config = r.config; emit();
        toast(`${icon('check', 16)} انحفظت إعدادات الاتصال`, { type: 'success' });
        paint();
      } else if (f.id === 'profForm') {
        const r = await api.put('/api/profile', { name: f.name.value, bio: f.bio.value, preferences: f.preferences.value });
        state.profile = r.profile; emit();
        toast(`${icon('check', 16)} انحفظ ملفك`, { type: 'success' });
      }
    } catch (err) { toast(esc(err.message), { type: 'error' }); }
  });

  root.addEventListener('click', async e => {
    if (e.target.closest('#testBtn')) {
      const b = e.target.closest('#testBtn');
      b.disabled = true;
      try {
        const r = await api.post('/api/config/test');
        toast(r.mock ? `${icon('bolt', 16)} الوضع التجريبي شغّال — أضف مفتاحاً للاتصال الحقيقي` : `${icon('check', 16)} الاتصال بـ DeepSeek ناجح!`, { type: r.mock ? 'info' : 'success' });
      } catch (err) { toast(esc(err.message), { type: 'error', timeout: 6000 }); }
      b.disabled = false;
    }
    if (e.target.closest('#clearKey')) {
      if (!(await confirmBox('إزالة المفتاح المحفوظ؟', { danger: true, okText: 'أزل' }))) return;
      const r = await api.post('/api/config', { clearKey: true });
      state.config = r.config; emit(); paint();
    }
    if (e.target.closest('#logoutBtn')) { await api.post('/api/logout'); location.reload(); return; }
    if (e.target.closest('#exportAll')) download(`majlis-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await api.get('/api/export'), null, 2), 'application/json');
    if (e.target.closest('#resetAll')) {
      if (!(await confirmBox('رح ينمسح كل شي: المدرّبين، الذاكرة، الأهداف، والمسارات. متأكد؟', { danger: true, okText: 'امسح كل شي' }))) return;
      await api.post('/api/reset', { confirm: 'RESET' });
      location.hash = '';
      location.reload();
    }
  });

  root.addEventListener('change', async e => {
    if (e.target.id === 'soundT') setPref('sound', e.target.checked);
    if (e.target.id === 'themeT') {
      const t = e.target.checked ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem('majlis.theme', t); } catch { /* ignore */ }
      emit();
    }
    if (e.target.id === 'notifT') {
      if (e.target.checked && Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { e.target.checked = false; toast('ما انسمح بالإشعارات من المتصفح'); return; }
      }
      setPref('notify', e.target.checked);
      if (e.target.checked) new Notification('مجلس', { body: 'تمام! رح نذكّرك بأهدافك ✨', icon: '/favicon.svg' });
    }
  });

  paint();
}
