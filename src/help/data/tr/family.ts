import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const familyBulletin: HelpArticle = {
  id: 'family-bulletin',
  title: 'Aile Panosu',
  description:
    'Tüm aileye veya seçili üyelere duyuru yayımlayın; öncelik, zamanlama ve sabitleme seçenekleriyle.',
  category: 'family',
  keywords: ['pano', 'duyuru', 'bildiri', 'haber', 'kural değişikliği', 'sabitlenmiş', 'acil', 'mesaj'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Uygulama içindeki ilan panosu. Ebeveynler duyuru yayımlar — kural değişikliği, hatırlatma, etkinlik, acil bildirim — ve bunlar seçtiğiniz kitleye, süresi dolana veya arşivlenene kadar görünür.'
      ),
    ]),
    section('why', [
      p(
        'Merdivenden seslenmek ölçeklenmez, sohbet uygulamasındaki mesajlar ise kayıp gider. Duyuru görünür kalır, kimin okuduğunu gösterir ve gerçekten önemliyse sabitlenebilir.'
      ),
    ]),
    section('who', [
      p(
        'Ebeveynler duyuru oluşturur, düzenler, arşivler ve siler. Herkes kendisine yönelik olanları okur ve okundu işaretleyebilir. Kitleler: tüm aile, tüm çocuklar, yalnızca ebeveynler/yetişkinler ya da seçili üyeler.'
      ),
    ]),
    section('how', [
      p('Her duyurunun bir başlığı, mesajı ve birkaç ayarı vardır:'),
      ul([
        'Tür — Genel, Kural değişikliği, Sonuç/hatırlatma, Yeni görev, Ödül güncellemesi, Etkinlik veya Acil bildirim.',
        'Öncelik — Normal, Önemli veya Acil.',
        'Kitle — aile, çocuklar, yetişkinler veya elle seçilmiş liste.',
        'Başlangıç ve bitiş zamanı — şimdi ya da ileri bir tarihe planlayın.',
        'Üste sabitle — her şeyin üzerinde tutar.',
        'Var olan bir görevi bağlayın ya da duyurudan tek seferlik görev oluşturun.',
      ]),
      info('Okunmamış duyurular rozetlenir; Aktif ve Geçmiş sekmeleri güncel olanı geçmiş olandan ayırır.'),
    ]),
    section('steps', [
      steps([
        { title: 'Panoyu açın', detail: 'Panoda görünür.' },
        { title: 'Duyuru oluştur’a dokunun', detail: 'Yalnızca ebeveynler.' },
        { title: 'Başlık ve mesaj yazın', detail: 'İkisi de zorunludur.' },
        { title: 'Tür ve öncelik seçin', detail: 'Acil’i gerçekten acil şeylere saklayın.' },
        { title: 'Kitleyi seçin', detail: 'Seçili üyeler için en az bir kişi gerekir.' },
        { title: 'Başlangıç ve bitişi ayarlayın', detail: 'Bitiş, başlangıçtan sonra olmalıdır.' },
        { title: 'Yayımlayın', detail: 'Üstte kalması gerekiyorsa sabitleyin.' },
      ]),
    ]),
    section('tips', [
      tip('İş duyuruyorsanız duyuruyu göreve bağlayın. Tek dokunuşla “bunu konuşmuştuk”tan “işte burada”ya geçilir.'),
      p('Süreli bildirimlere bitiş zamanı koyun; pano kendini temizler.'),
    ]),
    section('mistakes', [
      ul([
        'Her şeyi Acil işaretlemek; herkes acili yok saymayı öğrenir.',
        'Bir duyuruyu sabitleyip sabitlemesini hiç kaldırmamak.',
        'Kural değişikliğini önce konuşmadan panoya yazmak — uygulama bir kayıttır, konuşmanın yerine geçmez.',
      ]),
    ]),
  ],
  related: ['dashboard', 'tasks', 'notifications', 'family-management'],
};

export const approvalCenter: HelpArticle = {
  id: 'approval-center',
  title: 'Onay Merkezi',
  description:
    'Ebeveyn kararı bekleyen her şey tek kuyrukta: görev tamamlamaları, transferler, para istekleri, bağışlar, hedefler ve profil değişiklikleri.',
  category: 'family',
  keywords: ['onay', 'onayla', 'reddet', 'bekleyen', 'kuyruk', 'istekler', 'ebeveyn onayı'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Bir çocuğun yaptığı ya da istediği, ebeveyn kararı gerektiren her şeyin tek listesi. Her öğe onaylanabilir veya reddedilebilir; Geçmiş sekmesi kararlarınızı kaydeder.'
      ),
    ]),
    section('why', [
      p(
        'Ekranlara dağılmış onaylar gözden kaçar ve kaçan bir onay çocuğa görmezden gelinmek gibi gelir. Tek kuyruk tek alışkanlık demektir: temizleyin, hiçbir şey açıkta kalmasın.'
      ),
    ]),
    section('who', [
      p('Yalnızca ebeveynler. Çocuklar sonucu bildirimlerinde ve bakiyelerinde görür.'),
    ]),
    section('how', [
      p('Kuyruğa şu istek türleri düşer:'),
      ul([
        'Görev Tamamlama — çocuk, onay gerektiren bir görevi tamamladı işaretledi.',
        'Transfer İsteği — çocuk kardeşine para göndermek istiyor.',
        'Para İsteği — çocuk ebeveynden para istedi.',
        'Kardeş Para İsteği — kardeş isteği kabul etti, sizin onayınız bekleniyor.',
        'Pet Box Bağışı — çocuk bir evcil hayvan fonuna bağış yapmak istiyor.',
        'Hedef Katkısı ve Hedef Çekimi — birikim hedefine giren ya da çıkan para.',
        'Profil Güncelleme İsteği — çocuk adını veya avatarını değiştirmek istiyor.',
      ]),
      p('Onaylamak değişikliği anında uygular: puanlar düşer, para hareket eder, profil güncellenir. Reddetmek hiçbir şeye dokunmaz.'),
      warn('Para yalnızca onayla hareket eder. Siz karar verene kadar çocuğun bakiyesi tutarı hâlâ onun olarak gösterir.'),
    ]),
    section('steps', [
      steps([
        { title: 'Ana sayfayı açın', detail: 'Onay Merkezi ebeveyn panosundadır.' },
        { title: 'İstek satırını okuyun', detail: 'Çocuğu, tutarı ve varsa notu belirtir.' },
        { title: 'Onaylayın veya Reddedin', detail: 'Her biri tek dokunuş; liste anında güncellenir.' },
        { title: 'İtiraz varsa Geçmiş’e bakın', detail: 'Ne zaman neye karar verildiğini gösterir.' },
      ]),
    ]),
    section('tips', [
      tip('Kuyruğu her gün sabit bir saatte temizleyin. Çocuklar için öngörülebilirlik hızdan değerlidir.'),
      p('Önemli bir şeyi reddederken nedenini yüz yüze söyleyin. Uygulama kararı kaydeder, gerekçeyi değil.'),
    ]),
    section('mistakes', [
      ul([
        'Okumadan toplu onaylamak — onaylar gerçek parayı hareket ettirir.',
        'Kuyruğu bir hafta bekletip çocuğun yaptığını hatırlamadığı bir görevi onaylamak.',
        'Reddin çocuğa gerekçeli bir bildirim gönderdiğini varsaymak. Gerekçe içermez.',
      ]),
      soon('Redde eklenen not veya gerekçe.'),
    ]),
  ],
  related: ['tasks', 'child-transfers', 'savings-goals', 'parent-guide'],
};

export const familyManagement: HelpArticle = {
  id: 'family-management',
  title: 'Aile yönetimi',
  description:
    'Üye ekleyin, yetişkin üyeleri arşivleyin ya da çıkarın, çocuk profillerini yönetin ve sahipliği anlayın.',
  category: 'family',
  keywords: [
    'aile',
    'üyeler',
    'davet kodu',
    'çocuk ekle',
    'üye çıkar',
    'profil',
    'avatar',
    'sahip',
    'yönetilen çocuk',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  sections: [
    section('what', [
      p(
        'Aile sayfası ailenizdeki herkesi listeler ve her üyenin profiline bağlanır. Ayarlar → Aile ise aile adını, üye sayısını ve davet kodunu barındırır.'
      ),
    ]),
    section('why', [
      p(
        'Aile değişir: ikinci bir ebeveyn katılır, bir çocuk kendi girişini kullanacak yaşa gelir, biri ayrılır. Üyelik, aileyi baştan kurmadan değiştirilebilmelidir.'
      ),
    ]),
    section('who', [
      p(
        'Üyeleri ebeveynler yönetir. Aileyi kuran ebeveyn sahiptir; bu yalnızca hesap silinirken önemlidir, çünkü sahip önce sahipliği başka bir ebeveyne devretmelidir.'
      ),
    ]),
    section('how', [
      p(
        'Yeni üyeler kaydolurken davet kodunu girerek katılır. Çocuklar ayrıca bir ebeveyn tarafından oluşturulup yönetilebilir — cüzdanlar ekranında “Yönetilen” etiketiyle görünen yönetilen çocuk. Bir üyeye dokunmak; görevleri, puanları, cüzdanı ve geçmişiyle profilini açar.'
      ),
      p(
        'Çocuklar kendi adlarını ve avatarlarını düzenleyebilir, ancak değişiklik ebeveyne Profil Güncelleme İsteği olarak gider ve yalnızca onaylandığında geçerli olur.'
      ),
      info('Davet kodunu yenileme henüz mevcut değil; kodu yalnızca eklemek istediğiniz kişilerle paylaşın.'),
    ]),
    section('steps', [
      steps([
        { title: 'Ayarlar → Aile’yi açın', detail: 'Davet kodunu bulup kopyalayın.' },
        { title: 'Kodu özel olarak gönderin', detail: 'Koda sahip herkes ailenize katılabilir.' },
        { title: 'Kodla kaydolsunlar', detail: 'Yeni bir aileye değil, sizinkine düşerler.' },
        { title: 'Kontrol için Aile’yi açın', detail: 'Yeni üye listede görünür.' },
        { title: 'Profil için üyeye dokunun', detail: 'Görevler, puanlar, cüzdan ve geçmiş tek yerde.' },
      ]),
    ]),
    section('tips', [
      tip('Her çocuğa ayrı bir avatar ve renk verin. Küçük çocuklar isimleri okumadan çok önce renge göre gezinir.'),
      p('Sahip olarak kendi hesabınızı silmeden önce diğer ebeveyni yeni sahip olarak belirleyin.'),
    ]),
    section('mistakes', [
      ul([
        'Davet kodunu, amacından uzun süre yaşayan bir grup sohbetine yazmak.',
        'Bir yetişkin üyeyi “sıfırlamak” için çıkarmak — geçmişleri korunur, yani bu bir temizlik yapmaz. Çocuklar arşivlenir, asla çıkarılmaz.',
        'Çocuğun profil değişikliğinin anında uygulandığını sanmak. Onay bekler.',
      ]),
      soon('Eski kodu geçersiz kılmak için davet kodunu yenileme.'),
    ]),
  ],
  related: ['getting-started', 'account-security', 'approval-center', 'parent-guide'],
};

export default [familyBulletin, approvalCenter, familyManagement];
