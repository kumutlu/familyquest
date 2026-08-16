import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const accountSecurity: HelpArticle = {
  id: 'account-security',
  title: 'Hesap ve güvenlik',
  description:
    'Giriş yöntemleri, şifre değiştirme, dil, çıkış yapma ve hesabınızı ya da ailenizi silme.',
  category: 'account',
  keywords: [
    'hesap',
    'güvenlik',
    'şifre',
    'giriş',
    'çıkış',
    'google',
    'hesap silme',
    'gizlilik',
    'dil',
    'ayarlar',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        "Queki'ye erişiminizle ilgili her şey Ayarlar sayfasında: profiliniz, ailenin bilgileri, dil, güvenlik ve hesap silme."
      ),
    ]),
    section('why', [
      p(
        'Uygulama çocuklarınızın adlarını, avatarlarını ve para kayıtlarını tutar. Bu tür veriler için erişim denetimi ve gerçek bir silme yolu isteğe bağlı ayrıntılar değildir.'
      ),
    ]),
    section('who', [
      p(
        'Herkes kendi hesabını yönetir. Bir ebeveyn tarafından yönetilen çocuklar kendi hesaplarını silemez — bunun yerine ebeveyn onları Aile Ayarları’ndan arşivler ya da yönetilen çocuğu Tehlike Bölgesi üzerinden kalıcı olarak siler.'
      ),
    ]),
    section('how', [
      p('Ayarlar denetimleri gruplar:'),
      ul([
        'Profil — adınız ve avatarınız. Çocuklarda değişiklikler ebeveyn onayı gerektirir.',
        'Aile — aile adı, üye sayısı ve davet kodu.',
        'Dil — İngilizce veya Türkçe, tüm uygulamaya uygulanır.',
        'Güvenlik — e-postayla şifre sıfırlama ve Çıkış Yap.',
        'Hesabı sil — çok adımlı ve geri alınamaz bir akış.',
        'Hakkında — uygulama sürümü, derleme ve Gizlilik Politikası ile Şartlar bağlantıları.',
      ]),
      p(
        "Google ile giriş yapıyorsanız Queki içinde değiştirilecek bir şifre yoktur — Google hesabınızdan yönetin. Şifre sıfırlama, e-posta adresinize güvenli bir bağlantı gönderir."
      ),
      warn(
        'Hesabınızı silmek profilinizi, aile üyeliğinizi ve giriş bilgilerinizi siler ve geri alınamaz. Tek sahipseniz ve sahipliği devredecek kimse yoksa, hesabınızı silmek tüm aileyi ve verilerini de kalıcı olarak siler.'
      ),
    ]),
    section('steps', [
      p('Şifrenizi değiştirme:'),
      steps([
        { title: 'Ayarlar → Güvenlik’i açın', detail: '“Şifre değiştir”i bulun.' },
        { title: 'Sıfırlama e-postasını gönderin', detail: 'Hesabınızdaki adrese gider.' },
        { title: 'Bağlantıyı izleyin', detail: 'Yeni şifreyi belirleyip tekrar giriş yapın.' },
      ]),
      p('Hesabınızı silme: Ayarlar → Hesabı sil, ardından uyarıları adım adım geçin. Sahipseniz ya başka bir ebeveyni yeni sahip olarak belirlemeli ya da aile adını yazarak aile silmeyi onaylamalısınız. Önce şifrenizi doğrulamanız istenebilir.'),
    ]),
    section('tips', [
      tip('Hesapta iki ebeveyn olması, biri ayrılırsa diğerinin sahipliği devralabilmesi demektir.'),
      p('Çıkış yapmak silmek değildir. Yalnızca bu cihazdan çıkmak istiyorsanız Çıkış Yap’ı kullanın.'),
    ]),
    section('mistakes', [
      ul([
        'Giriş sorununu çözmek için hesabı silmek. Önce şifre sıfırlamayı deneyin.',
        'Çocuğun davet kodu yerine yeniden kaydolması ve ikinci bir boş aile oluşturması.',
        'Hesap silmenin geri alınabilir olduğunu sanmak. Değildir.',
      ]),
      soon('İki adımlı doğrulama ve cihaz bazlı oturum yönetimi.'),
    ]),
  ],
  related: ['family-management', 'notifications', 'troubleshooting', 'getting-started'],
};

export const notifications: HelpArticle = {
  id: 'notifications',
  title: 'Bildirimler',
  description:
    'Uygulama içi bildirimler, bildirim merkezi ve bir cihazda anlık bildirimleri etkinleştirme.',
  category: 'account',
  keywords: ['bildirimler', 'uyarılar', 'push', 'bildirim merkezi', 'engellendi', 'izin', 'hatırlatma'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Queki bir şey olduğunda size haber verir: onay bekleyen görev, gelen para, onaylanan transfer, kaydedilen davranış. Bunlar uygulama içi bildirim merkezinde ve isterseniz cihazınızda anlık bildirim olarak görünür.'
      ),
    ]),
    section('why', [
      p(
        'Onayla-ve-kazan döngüsünün tamamı birinin fark etmesine bağlıdır. Bildirimler, çocuğun tamamladığı görevin üç gün onaysız beklemesini engelleyen şeydir.'
      ),
    ]),
    section('who', [
      p(
        'Herkes. Ebeveynler ağırlıklı olarak onay isteklerini; çocuklar görev sonuçlarını, cüzdan değişikliklerini, transferleri ve davranış güncellemelerini alır.'
      ),
    ]),
    section('how', [
      p('Şu anda uygulama içinde iletilen bildirim kategorileri:'),
      ul([
        'Görev güncellemeleri',
        'Ödül istekleri',
        'Cüzdan güncellemeleri',
        'Transfer güncellemeleri',
        'Davranış güncellemeleri',
        'Pet Box güncellemeleri',
      ]),
      p(
        'Anlık bildirimler cihaz bazlıdır ve siz etkinleştirene kadar kapalıdır. Ayarlar geçerli durumu gösterir: bu cihazda etkin, etkin değil, tarayıcı ayarlarında engellendi ya da bu tarayıcıda desteklenmiyor.'
      ),
      info(
        'Bildirim merkezi gerçek zamanlıdır ve bir bağlantı durumu gösterir. Uzun süre “Bağlanıyor…” yazıyorsa Bağlantıyı yeniden dene’yi kullanın.'
      ),
      soon('Kategori bazlı bildirim tercihleri — bugün kategoriler bilgilendirme amaçlıdır ve tek tek kapatılamaz.'),
    ]),
    section('steps', [
      steps([
        { title: 'Ayarlar → Bildirimler’i açın', detail: 'Anlık bildirim durumunu kontrol edin.' },
        { title: '“Anlık bildirimleri etkinleştir”e dokunun', detail: 'Tarayıcınız izin isteyecek.' },
        { title: 'İzin istemine izin verin', detail: 'Kapatırsanız durum Engellendi görünür.' },
        { title: 'Engellendiyse tarayıcıdan düzeltin', detail: 'Site için bildirimleri açın ve geri dönün.' },
        { title: 'Her cihazda tekrarlayın', detail: 'Anlık bildirim hesap başına değil, cihaz başına kaydedilir.' },
      ]),
    ]),
    section('tips', [
      tip("Anlık bildirimi açmadan önce Queki'yi ana ekranınıza ekleyin. Mobil tarayıcılarda bu yol çok daha güvenilirdir."),
      p('Ebeveynler: her yerde açmak yerine gerçekten yanınızda taşıdığınız tek cihazda açın.'),
    ]),
    section('mistakes', [
      ul([
        'İzin istemini yanlışlıkla engelleyip anlık bildirimin bozuk olduğunu sanmak.',
        'Ortak bir bilgisayarda anlık bildirimi açıp aile bildirimlerini başkalarının önünde almak.',
        'E-posta beklemek. Queki etkinlik e-postası göndermez.',
      ]),
    ]),
  ],
  related: ['account-security', 'approval-center', 'dashboard', 'troubleshooting'],
};

export default [accountSecurity, notifications];
