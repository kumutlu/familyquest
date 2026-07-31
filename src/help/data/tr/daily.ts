import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const dashboard: HelpArticle = {
  id: 'dashboard',
  title: 'Panel',
  description:
    'Ana ekran: bugünün ilerlemesi, puanlar, seviyeler, seriler ve ebeveynler için onay kuyruğu.',
  category: 'daily',
  keywords: ['ana sayfa', 'panel', 'ilerleme', 'seviye', 'xp', 'seri', 'mükemmel gün', 'bugün'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  gettingStartedOrder: 5,
  sections: [
    section('what', [
      p(
        'Ana sayfa, giriş yaptıktan sonraki ilk ekrandır. Çocuklar bugüne ait kendi ilerlemelerini görür; ebeveynler ailenin genel durumunu ve karar bekleyen her şeyi görür.'
      ),
    ]),
    section('why', [
      p(
        'Bir aile uygulaması, durumu aramak zorunda kaldığınızda işe yaramaz. Panel “bugün ne kaldı?” ve “benden ne bekleniyor?” sorularını tek dokunuş bile gerektirmeden yanıtlar.'
      ),
    ]),
    section('who', [
      p('Herkes; role göre farklı düzenle — çocuk paneli ve ebeveyn paneli.'),
    ]),
    section('how', [
      p('Çocuk görünümü oyunlaştırma motorundan beslenir:'),
      ul([
        'Günlük ilerleme — bugünkü görevlerin kaçı tamamlandı.',
        'Puan ve XP — görevlerden ve olumlu davranışlardan kazanılan puanlar.',
        'Seviye — toplam XP’nizin karşılık geldiği seviye.',
        'Seri — görev tamamlanan üst üste günler.',
        'Mükemmel gün — bugüne planlanmış her görevin bitmesi.',
      ]),
      p(
        'Ebeveyn görünümü buna Onay Merkezi’ni ve çocuk başına özeti ekler; böylece aynı ekrandan hem onaylar hem de duraksayan çocuğu fark edersiniz.'
      ),
      info('Aile Panosu da burada görünür, böylece duyuruların kaçırılması imkânsızdır.'),
    ]),
    section('steps', [
      steps([
        { title: 'Uygulamayı açın', detail: 'Ana sayfa varsayılan sekmedir.' },
        { title: 'Bugünün ilerleme halkasını okuyun', detail: 'Yalnızca bugüne planlanmış görevleri sayar.' },
        { title: 'Ebeveynler: onay listesini boşaltın', detail: 'Her bekleyen öğeyi onaylayın veya reddedin.' },
        { title: 'Bir çocuğa dokunun', detail: 'Görevleri, cüzdanı ve geçmişiyle profili açılır.' },
      ]),
    ]),
    section('tips', [
      tip('Çoğu çocuk için ekrandaki en motive edici sayı seridir. Koruyun: çok kolay tek bir günlük görev, kötü günlerde seriyi ayakta tutar.'),
      p("Queki'yi ana ekrana ekleyin ki Ana sayfa tek dokunuş uzakta olsun."),
    ]),
    section('mistakes', [
      ul([
        'İlerleme halkasının haftalık görevleri içerdiğini sanmak. Yalnızca bugünü gösterir.',
        'Gecelik özet beklemek — panel canlıdır, özet e-postası yoktur.',
      ]),
      soon('Hangi kartların görüneceğini seçebileceğiniz özelleştirilebilir panel.'),
    ]),
  ],
  related: ['tasks', 'approval-center', 'family-bulletin', 'child-guide'],
};

export const tasks: HelpArticle = {
  id: 'tasks',
  title: 'Görevler',
  description:
    'Ev işleri ve rutinler oluşturun, planlayın, puan değerini belirleyin ve onay gerekip gerekmediğine karar verin.',
  category: 'daily',
  keywords: [
    'görevler',
    'ev işi',
    'iş',
    'plan',
    'günlük',
    'haftalık',
    'puan',
    'onay',
    'tekrarlayan',
    'şablon',
  ],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Görevler puan kazandıran işlerdir. Her görevin bir başlığı, isteğe bağlı açıklaması, puan değeri, planı, atanan kişisi ve onay ayarı vardır.'
      ),
    ]),
    section('why', [
      p(
        'Yazılı beklentiler günlük pazarlığı bitirir. Görev, işi ve bedelini bir kez tanımlar; böylece “buna değmez” tartışması her akşam değil, görevi oluştururken yapılır.'
      ),
    ]),
    section('who', [
      p(
        'Ebeveynler görev oluşturur, düzenler ve arşivler. Çocuklar tamamlar. Bir görev tek bir çocuğa atanabilir ya da “Herkes (Ortak)” bırakılarak ilk ulaşanın alması sağlanabilir.'
      ),
    ]),
    section('how', [
      p('Planlar görevin ne zaman görüneceğini belirler:'),
      ul([
        'Günlük — her gün.',
        'Hafta içi (Pzt–Cum) veya Hafta sonu (Cmt–Paz).',
        'Haftalık — haftada bir.',
        'Özel günler — günleri tek tek seçin.',
        'Tek seferlik — yapılana kadar görünür.',
      ]),
      p(
        '“Ebeveyn Onayı Gerekir” açıksa, tamamlandı işaretlemek görevi “Onay bekleniyor” durumuna alır ve puanlar ancak bir ebeveyn Onay Merkezi’nde onayladıktan sonra gelir. Kapalıysa puanlar hemen düşer.'
      ),
      info('Görevler sayfasındaki filtreler — Tümü, Günlük, Hafta içi, Hafta sonu, Haftalık, Tek Seferlik — bu planlarla eşleşir.'),
    ]),
    section('steps', [
      p('Görev oluşturma (ebeveyn):'),
      steps([
        { title: 'Görevler’i açıp Görev Ekle’ye dokunun', detail: 'Ya da hazır şablonlardan birini seçin.' },
        { title: 'Sade bir ad verin', detail: '“Bulaşık makinesini boşalt”, “Mutfak yardımı”ndan iyidir.' },
        { title: 'Puan ödülünü belirleyin', detail: 'Günlük işleri benzer aralıkta tutun.' },
        { title: 'Atanan çocuğu seçin', detail: 'Veya “Herkes (Ortak)”.' },
        { title: 'Planı seçin', detail: 'Özel günler ile tek tek gün seçebilirsiniz.' },
        { title: 'Onaya karar verin', detail: 'Kontrol etmek istediğiniz her şey için açın.' },
        { title: 'Kaydedin', detail: 'Atanan çocukta hemen görünür.' },
      ]),
      p('Görevi tamamlama (çocuk): Görevler’i aç, göreve dokun, “Tamamlandı olarak işaretle”yi seç.'),
    ]),
    section('tips', [
      tip('İlk grupta şablonları kullanın, sonra ifadeleri ailenizin gerçekten konuştuğu dile göre düzenleyin.'),
      p('Sıkıcı ve gözle görülür günlük işlerde onayı kapatın. Puanı yüksek işlerde açık bırakın.'),
      p('Bir görevi yalnızca bir haftalığına duraklatmak istiyorsanız arşivlemek yerine “Aktif Durum”u kapatın.'),
    ]),
    section('mistakes', [
      ul([
        'Her görevin onay gerektirmesi; kuyruk oluşur ve her ödeme gecikir.',
        'Puan değerlerinin kayması — beş dakikalık iş, otuz dakikalıktan değerli olur.',
        'Toparlamak için görev silmek. Bunun yerine arşivleyin ki eski tamamlamalar anlamlı kalsın.',
        '“Bugün uygun değil” yazısını unutmak: o görev yalnızca bugüne planlanmamıştır.',
      ]),
    ]),
  ],
  related: ['approval-center', 'rewards', 'behaviours', 'dashboard'],
};

export const behaviours: HelpArticle = {
  id: 'behaviours',
  title: 'Davranışlar',
  description:
    'Tek seferlik olumlu veya olumsuz olayları kaydedin: bonus puan, puan kesintisi veya para cezası.',
  category: 'daily',
  keywords: ['davranış', 'bonus', 'ceza', 'olumsuz', 'olumlu', 'puan', 'kesinti'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  sections: [
    section('what', [
      p(
        'Davranış, bir ebeveynin bir çocuk için gerekçesiyle birlikte kaydettiği tek seferlik olaydır. Üç tür vardır: Olumlu (puan ekler), Olumsuz (puan siler) ve Ceza (çocuğun cüzdanından para düşer).'
      ),
    ]),
    section('why', [
      p(
        'Hayat planlı görevlere sığmaz. Davranışlar plansız olanı yakalar — ödüllendirilmeyi hak eden gönüllü yardımı ya da gerçekten sonuç gerektiren durumu — sahte bir görev uydurmadan.'
      ),
    ]),
    section('who', [
      p('Yalnızca ebeveynler. Çocuklar sonucu puanlarında, cüzdanlarında ve bildirimlerinde yazdığınız gerekçeyle görür.'),
    ]),
    section('how', [
      p(
        'Türü, çocuğu, gerekçeyi ve puan sayısını — ceza için para tutarını — seçersiniz. Anında uygulanır; davranışlar Onay Merkezi’nden geçmez ve çocuğun geçmişinde “Davranış cezası” ya da puan değişimi olarak görünür.'
      ),
      warn(
        'Para cezası, çocuğun cüzdanından gerçek parayı hemen çıkarır. Az kullanın ve çocuğun tanıyacağı bir gerekçe yazın.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Çocuğun profilini veya ebeveyn panosunu açın', detail: '“Davranış Kaydet”i bulun.' },
        { title: 'Türü seçin', detail: 'Olumlu, Olumsuz veya Ceza.' },
        { title: 'Çocuğu seçin', detail: 'Davranışlar her zaman tek bir çocuğu hedefler.' },
        { title: 'Gerekçeyi yazın', detail: 'Örneğin “Alışverişe yardım etti”.' },
        { title: 'Puan veya ceza tutarı girin', detail: 'Cezalar aile para biriminizdedir.' },
        { title: 'Olayı Kaydet’e dokunun', detail: 'Değişiklik anında uygulanır.' },
      ]),
    ]),
    section('tips', [
      tip('Olumluları olumsuzlardan en az üç kat fazla kaydedin; yoksa bu özellik çocukların korktuğu bir şeye dönüşür.'),
      p('Gerekçeler çocuğa gösterilir. Yüz yüze söyleyeceğiniz gibi yazın.'),
    ]),
    section('mistakes', [
      ul([
        'Olumsuz puan yeterken para cezası kullanmak.',
        'Çocuğun ders çıkaramayacağı “tavır” gibi belirsiz gerekçeler.',
        'Öfkeyle kaydetmek. Sayıyı düzeltseniz de çocuğun hissettiğinin geri alması yoktur.',
      ]),
      soon('Davranış kaydını doğrudan günlükten düzenleme veya geri alma.'),
    ]),
  ],
  related: ['tasks', 'wallet', 'parent-guide', 'notifications'],
};

export const rewards: HelpArticle = {
  id: 'rewards',
  title: 'Ödüller',
  description:
    'Çocukların puanlarını harcadığı kataloğu kurun: fiyatlar, kategoriler ve isteğe bağlı stok sınırı.',
  category: 'daily',
  keywords: ['ödüller', 'kullan', 'hediye', 'puan', 'mağaza', 'katalog', 'stok', 'envanter'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Ödüller puanların amacıdır: ekran süresi, bir ikram, bir gezi, bir eşya. Her ödülün adı, puan cinsinden bedeli, bir simge kategorisi ve isteğe bağlı stok sınırı vardır.'
      ),
    ]),
    section('why', [
      p(
        'Alacak bir şeyi olmayan puanın değeri yoktur. Katalog, emeği çocuğun önceden seçtiği bir şeye dönüştürür; döngüyü değerli kılan da budur.'
      ),
    ]),
    section('who', [
      p('Ebeveynler ödül oluşturur, düzenler ve arşivler. Çocuklar yeterli puanları olduğunda kullanır.'),
    ]),
    section('how', [
      p(
        'Çocuk Ödüller’i açar ve bir ödüle dokunur. Puanı yetiyorsa ve stokta varsa, Kullan puanları düşer ve kullanım geçmişe kaydedilir. Envanter belirlenmişse kalan sayı bir azalır; sıfıra düştüğünde ödül tükendi olarak görünür.'
      ),
      p('Simge kategorileri: Hediye/Eşya, Ekran Süresi/Oyun, Yiyecek/İkram ve Deneyim/Gezi.'),
      info('Kullanım geçmişi kimin neyi kullandığını listeler; kimsenin hatırlamasına gerek kalmaz.'),
    ]),
    section('steps', [
      steps([
        { title: 'Ödüller’i açıp Ödül Ekle’ye dokunun', detail: 'Formda şablonlar mevcuttur.' },
        { title: 'Ödülü adlandırın', detail: 'Net olun: “30 dakika ekstra ekran süresi”.' },
        { title: 'Puan bedelini belirleyin', detail: 'Haftalık emeğe karşılık bir ulaşılabilir ödül hedefleyin.' },
        { title: 'Sınırlıysa envanter girin', detail: 'Sınırsız için boş bırakın.' },
        { title: 'Simge kategorisi seçin', detail: 'Küçük çocuklar için listeyi taranabilir yapar.' },
        { title: 'Kaydedin', detail: 'Çocuklar hemen kullanabilir.' },
      ]),
    ]),
    section('tips', [
      tip('Çocukların iki üç günde alabileceği ucuz bir ödül bulundurun. Yalnızca uzun vadeli kataloglar motivasyonu öldürür.'),
      p('Gerçeğe göre fiyatlayın: bir çocuğun haftada kazanabileceği puanı hesaplayın, en üst ödülü bunun iki üç haftalığına koyun.'),
    ]),
    section('mistakes', [
      ul([
        'Ebeveynin sonradan vermeyi reddettiği ödüller. Sistemin güvenilirliği anında biter.',
        'Yanlışlıkla envanteri 1 yapıp ödülün neden kaybolduğunu merak etmek.',
        'Hiç yeniden fiyatlamamak. Bir aydır hiçbir şey kullanılmadıysa fiyatlarınız yanlıştır.',
      ]),
      soon('Kullanım öncesi onay. Bugün ödül kullanımı çocuk için anında gerçekleşir.'),
    ]),
  ],
  related: ['tasks', 'child-guide', 'savings-goals', 'dashboard'],
};

export default [dashboard, tasks, behaviours, rewards];
