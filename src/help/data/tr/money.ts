import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const wallet: HelpArticle = {
  id: 'wallet',
  title: 'Cüzdan',
  description:
    'Gerçek para bakiyeleri: para ekleme ve çekme, para içgörüleri, bekleyen transferler ve işlem geçmişi.',
  category: 'money',
  keywords: [
    'cüzdan',
    'para',
    'bakiye',
    'işlemler',
    'geçmiş',
    'para ekle',
    'para çek',
    'içgörü',
    'bekleyen',
  ],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Her çocuğun, aile para biriminizde gerçek para bakiyesi tutan bir cüzdanı vardır. Cüzdan ekranı kullanılabilir bakiyeyi, para içgörülerini, bekleyen transferleri ve tüm işlem listesini gösterir.'
      ),
    ]),
    section('why', [
      p(
        'Nakit ceplerde ve hafızada kaybolur. Cüzdan, çocuğa kendi kontrol edebileceği bir bakiye ve “ama sen bunu zaten vermiştin” tartışmasını bitiren bir geçmiş verir.'
      ),
    ]),
    section('who', [
      p(
        'Çocuklar kendi cüzdanlarını görür. Ebeveynler Çocuk Cüzdanları ekranından tüm cüzdanları görür ve para ekleyip çekebilen tek roldür.'
      ),
    ]),
    section('how', [
      p('Cüzdan ekranı birkaç bloktan oluşur:'),
      ul([
        'Kullanılabilir bakiye — şu anda harcanabilir para.',
        'Para içgörüleri — giren para, çıkan para ve bekleyen toplam.',
        'Hızlı işlemler — çocuklar için Para Gönder ve Para İste.',
        'Bekleyen transferler — ebeveyn onayı bekleyen her şey.',
        'Son işlemler — gelir, gider, ödüller, harçlıklar, hedefler, düzeltmeler ve duruma göre filtrelenebilir ve aranabilir.',
      ]),
      info(
        'Bakiye yalnızca bir işlem tamamlandığında değişir. Bekleyen transferdeki para, onaylanana kadar bakiyenizde görünmeye devam eder.'
      ),
    ]),
    section('steps', [
      p('Ebeveyn — para ekleme veya çekme:'),
      steps([
        { title: 'Aile’yi, sonra çocuğu açın', detail: 'Ya da Çocuk Cüzdanları ekranına gidin.' },
        { title: 'Cüzdanı Yönet’e dokunun', detail: 'Para Ekle ve Para Çek sekmeleri vardır.' },
        { title: 'Tutarı ve bir not girin', detail: 'Örneğin “Harçlık”.' },
        { title: 'Onaylayın', detail: 'Bakiye ve geçmiş anında güncellenir.' },
      ]),
      p('Herkes — bir işlemi inceleme: cüzdanı açın, satıra dokunun ve kimin işlem yaptığı, not, referans ve sonraki bakiye dahil ayrıntıları okuyun.'),
    ]),
    section('tips', [
      tip('Her zaman not yazın. Altı hafta sonra o sayıyı açıklayan tek şey nottur.'),
      p('Geçmiş ekranında kaydırmak yerine arama kutusunu ve filtreleri kullanın.'),
    ]),
    section('mistakes', [
      ul([
        '“Bekleyen”i “gitti” sanmak. Bekleyen para onaylanana kadar sizindir.',
        'Davranışsal bir gerekçe varken ceza kaydetmek yerine para çekmek — geçmiş nedeni gizler.',
        "Cüzdanın gerçek bir banka hesabına bağlanmasını beklemek. Queki'deki bakiyeler ailenizin tuttuğu bir kayıttır, banka değildir.",
      ]),
      soon('Banka veya kart entegrasyonu. Queki parayı izler, gerçek dünyada hareket ettirmez.'),
    ]),
  ],
  related: ['child-transfers', 'weekly-allowance', 'savings-goals', 'approval-center'],
};

export const childTransfers: HelpArticle = {
  id: 'child-transfers',
  title: 'Çocuk transferleri',
  description:
    'Çocuklar kardeşine nasıl para gönderir, ebeveyninden nasıl para ister — ve neden her zaman bir ebeveyn onaylar.',
  category: 'money',
  keywords: [
    'transfer',
    'para gönder',
    'para iste',
    'kardeş',
    'bekleyen transfer',
    'onay',
    'havale',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Çocuğun başlattığı iki para işlemi. Para Gönder, bir çocuktan ailedeki başka bir çocuğa para aktarır. Para İste ise bir ebeveynden — ya da kardeşten — size para göndermesini ister.'
      ),
    ]),
    section('why', [
      p(
        'Çocuklar birbirine sürekli borç verir. Bunu uygulamadan geçirmek borcu görünür kılar ve para hareket etmeden önce ebeveyne veto hakkı verir; klasik “bana borçlusun” çıkmazını önler.'
      ),
    ]),
    section('who', [
      p(
        'Transferler yalnızca aynı ailedeki çocuklar arasında gönderilebilir — çocuk ebeveyne ya da kendisine para gönderemez. İstekler bir ebeveyne veya kardeşe yöneltilebilir. İkisini de ebeveynler onaylar.'
      ),
    ]),
    section('how', [
      p(
        'Bir çocuk para gönderdiğinde bakiyesinden hemen bir şey çıkmaz: transfer, Bekleyen transferler altında “Ebeveyn onayı bekleniyor” olarak görünür. Ebeveyn bunu Onay Merkezi’nde Transfer İsteği olarak görür ve onaylar ya da reddeder. Para yalnızca onayla hareket eder.'
      ),
      p(
        'Kardeşe yapılan para isteği önce o kardeşe gider. Kardeş kabul ederse, para hareket etmeden önce yine de ebeveyn onayı gerekir.'
      ),
      warn('Kullanılabilir bakiyenizden fazlasını gönderemezsiniz ve tutarlar en fazla iki ondalık basamak içerebilir.'),
    ]),
    section('steps', [
      p('Kardeşe para gönderme:'),
      steps([
        { title: 'Cüzdanınızı açın', detail: 'Hızlı işlemler altında Para Gönder’e dokunun.' },
        { title: 'Kardeşi seçin', detail: 'Yalnızca ailenizdeki çocuklar listelenir.' },
        { title: 'Tutarı girin', detail: 'Ebeveyn onaylayana kadar bakiyeniz aynı kalır.' },
        { title: 'Not ekleyin', detail: 'Örneğin “Kitap için teşekkürler!”.' },
        { title: 'İstek Gönder’e dokunun', detail: 'Artık Bekleyen transferlerde görünür.' },
      ]),
      p('Para isteme: cüzdanınızı açın, Para İste’ye dokunun, bir ebeveyn veya kardeş seçin, tutarı ve notu girip gönderin.'),
    ]),
    section('tips', [
      tip('Notlar her şeyi belirler. “Cumartesi sinema için” yazan bir istek, kuru bir tutardan çok daha hızlı onaylanır.'),
      p('Transfer bekliyorsa ikinci bir tane göndermek yerine Onay Merkezi’ne bakın.'),
    ]),
    section('mistakes', [
      ul([
        'Bakiye değişmedi diye iki kez göndermek. Bakiye onaya kadar değişmez.',
        'Ebeveyne para göndermeye çalışmak — transferler yalnızca çocuklar arasındadır.',
        'Gerekçesiz yuvarlak bir tutar isteyip onaylanacağını varsaymak.',
      ]),
    ]),
  ],
  related: ['wallet', 'approval-center', 'child-guide', 'notifications'],
};

export const weeklyAllowance: HelpArticle = {
  id: 'weekly-allowance',
  title: 'Haftalık harçlık',
  description:
    "Queki'de bugün düzenli harçlığı nasıl yürütürsünüz ve geçmişteki harçlık kategorisi ne anlama gelir.",
  category: 'money',
  keywords: ['harçlık', 'cep harçlığı', 'haftalık', 'düzenli', 'ödeme günü', 'tekrarlayan para'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  sections: [
    section('what', [
      p(
        "Çocuğun cüzdanına düzenli yapılan ödeme — klasik cep harçlığı düzeni. Queki'de harçlık, ebeveynin çocuğun cüzdanına yaptığı bir yatırmadır ve işlem geçmişinde harçlık olarak etiketlenir."
      ),
    ]),
    section('why', [
      p(
        'Harçlık ile kazanç farklı işler görür. Kazanç emeği ödüllendirir; temel harçlık ise ne olursa olsun geldiği için bütçe yapmayı öğretir. Harçlık etiketini ayrı tutmak, geçmişte hangisinin ne olduğunu görmenizi sağlar.'
      ),
    ]),
    section('who', [
      p('Harçlığı ebeveynler öder. Çocuklar bunu cüzdanlarında ve para içgörülerinde görür.'),
    ]),
    section('how', [
      p(
        'Çocuğun cüzdanını açın, Cüzdanı Yönet → Para Ekle’yi seçin, tutarı girin ve notta “Allowance” (harçlık) ifadesini kullanın. İşlem böylece harçlık olarak sınıflandırılır; geçmişi Harçlıklar filtresiyle süzerek görev kazançlarından ayrı takip edebilirsiniz.'
      ),
      soon(
        'Otomatik zamanlanmış harçlık. Queki henüz harçlığı zamanlayıcıyla ödemiyor — bugün her harçlık ebeveynin yaptığı bir yatırmadır.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Sabit bir gün seçin', detail: 'Her hafta aynı gün; tüm fayda tutarlılıkta.' },
        { title: 'Çocuğun cüzdanını açın', detail: 'Aile → çocuk → Cüzdanı Yönet.' },
        { title: 'Para Ekle', detail: 'Haftalık tutarı girin.' },
        { title: 'Nota “Allowance” yazın', detail: 'Harçlık olarak etiketleyen şey budur.' },
        { title: 'Onaylayın', detail: 'Çocuğa bildirim gider ve bakiye güncellenir.' },
        { title: 'Her hafta tekrarlayın', detail: 'Zamanlama gelene kadar telefonunuza hatırlatıcı kurun.' },
      ]),
    ]),
    section('tips', [
      tip('Harçlığı mütevazı tutun, artışı görevlerden gelsin. Harçlık her şeyi karşılıyorsa görevler anlamsızlaşır.'),
      p('Birkaç aylık ödemeyi tek görünümde incelemek için cüzdan geçmişini Harçlıklar ile filtreleyin.'),
    ]),
    section('mistakes', [
      ul([
        'Haftaları sessizce atlamak. Güvenilmez harçlık yalnızca yetişkinlerin unuttuğunu öğretir.',
        'Ceza olarak harçlığı kesmek; davranış cezası kaydetmek yerine bunu yapmak gerekçeyi kaybettirir.',
        'Ödemenin kendiliğinden olmasını beklemek. Henüz olmuyor.',
      ]),
    ]),
  ],
  related: ['wallet', 'behaviours', 'savings-goals', 'parent-guide'],
};

export const savingsGoals: HelpArticle = {
  id: 'savings-goals',
  title: 'Birikim hedefleri',
  description:
    'Bir hedef belirleyin, katkı yapın, ebeveyn katkısı ekleyin ve zamanı gelince onayla çekin.',
  category: 'money',
  keywords: ['hedefler', 'birikim', 'tasarruf', 'hedef tutar', 'katkı', 'eşleştirme', 'çekim', 'aile hedefi'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Birikim hedefi, tutarı belli adlandırılmış bir hedeftir — bisiklet, oyun, aile gezisi. Hedefe konan para cüzdanda serbest durmak yerine o hedefe ayrılır.'
      ),
      p('İki tür vardır: herkesin katkı yapabildiği aile hedefi ve tek bir çocuğa ait çocuk hedefi.'),
    ]),
    section('why', [
      p(
        'Biriktirmek zordur çünkü para her yere gider. Hedefe bir ad ve bir ilerleme çubuğu vermek tercihi somutlaştırır: şimdi bu ödül mü, yoksa bisiklet daha erken mi?'
      ),
    ]),
    section('who', [
      p(
        'Ebeveynler hedef oluşturur ve ebeveyn katkısı ekleyebilir — sabit bir tutar ya da çocuğun koyduğunun yüzdesi kadar eşleştirme. Çocuklar cüzdanlarından katkı yapar ve çekim talep eder.'
      ),
    ]),
    section('how', [
      p(
        'Bir başlık, hedef tutar ve — çocuk hedefiyse — hedefin sahibi çocukla hedef oluşturun. İsteğe bağlı olarak ebeveyn katkısı ekleyin: sabit tutar ya da her çocuk katkısını tamamlayan bir yüzde. Çocuktan gelen katkı ve çekimler, Onay Merkezi’ne Hedef katkısı ve Hedef çekimi isteği olarak düşer.'
      ),
      info('İptal edilen hedefler ebeveyn tarafından Hedefler sayfasından silinebilir; tamamlanmış geçmiş korunur.'),
    ]),
    section('steps', [
      steps([
        { title: 'Hedefler’i açın', detail: 'Çocuk profilinden veya doğrudan bağlantıdan ulaşın.' },
        { title: 'Ekle düğmesine dokunun', detail: 'Aile hedefi ya da Çocuk hedefi seçin.' },
        { title: 'Hedefi adlandırın ve tutarı girin', detail: 'Yuvarlak tahmin değil, gerçek fiyatı kullanın.' },
        { title: 'Ebeveyn katkısını seçin', detail: 'Yok, sabit tutar veya yüzde eşleştirme.' },
        { title: 'Kaydedin', detail: 'Hedef ilerleme çubuğuyla görünür.' },
        { title: 'Katkı yapın', detail: 'Çocuk cüzdanından katkı yapar; ebeveyn onaylar.' },
        { title: 'Zamanı gelince çekin', detail: 'Çocuk talep eder; ebeveyn çekimi onaylar.' },
      ]),
    ]),
    section('tips', [
      tip('Yüzde eşleştirme en etkili birikim motivasyonudur: “biriktirdiğin her liraya ben elli kuruş ekliyorum”.'),
      p('Çocuk başına tek hedef tutun. Üç paralel hedef, hiçbirinin bitmemesi demektir.'),
    ]),
    section('mistakes', [
      ul([
        'İlerleme çubuğunun gözle görülür şekilde hiç ilerlemediği kadar büyük hedefler.',
        'Hedef parasını harcanabilir saymak — geri gelmesi için onaylı bir çekim gerekir.',
        'Hedefi iptal etmek yerine silmek ve geçmişin anlamını kaybetmek.',
      ]),
    ]),
  ],
  related: ['wallet', 'approval-center', 'rewards', 'child-guide'],
};

export const petBox: HelpArticle = {
  id: 'pet-box',
  title: 'Pet Box',
  description:
    'Her evcil hayvan için ortak fon: bütçeler, çocuklardan bağışlar, giderler ve yardımcı sıralaması.',
  category: 'money',
  keywords: ['pet box', 'evcil hayvan', 'fon', 'bağış', 'gider', 'veteriner', 'bütçe', 'sıralama'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Pet Box, her evcil hayvan için ortak bir fon tutar. Her hayvanın aylık bütçesi, isteğe bağlı acil durum hedefi, bakiyesi, bağış listesi ve mama, kum, veteriner, sigorta, oyuncak ya da bakım gibi kategorilerde gider kaydı vardır.'
      ),
    ]),
    section('why', [
      p(
        'Evcil hayvanlar bir ailenin ortak sorumluluk konusundaki en net dersidir: kimse istese de istemese de her ay para götürürler. Pet Box bu maliyeti görünür kılar ve çocukların karşılamaya katılmasını sağlar.'
      ),
    ]),
    section('who', [
      p(
        'Ebeveynler hayvan ekler, bütçeleri belirler ve giderleri kaydeder. Çocuklar cüzdanlarından bağış yapar — bağış, ebeveyn onayı gerektiren bir istektir ve onaylanana kadar paraları düşmez. En Çok Yardım Edenler sıralaması kimin katkı verdiğini gösterir.'
      ),
    ]),
    section('how', [
      p(
        'Fon kartı bakiyeyi, aylık bütçenin ne kadarının harcandığını ve acil durum hedefine ilerlemeyi gösterir. Giderler bakiyeyi aşarsa kart ne kadar daha gerektiğini yazar. Giderleri ebeveyn tutar, kategori ve açıklamayla kaydeder.'
      ),
      info('Çocuk bağışı, ebeveyn onaylayana kadar Onay Merkezi’nde Pet Box Bağışı olarak görünür.'),
    ]),
    section('steps', [
      steps([
        { title: 'Pet Box’ı açın', detail: 'Panodan ve doğrudan bağlantılardan erişilir.' },
        { title: 'Ebeveyn: Hayvan Ekle', detail: 'Ad, tür, aylık bütçe, isteğe bağlı acil durum hedefi.' },
        { title: 'Çocuk: Hızlı Bağış', detail: 'Bir tutar girip onaya gönderin.' },
        { title: 'Ebeveyn: bağışı onaylayın', detail: 'Çocuğun parası ancak o zaman düşer.' },
        { title: 'Ebeveyn: Gider Ekle', detail: 'Tutar, kategori ve kısa bir açıklama.' },
        { title: 'En Çok Yardım Edenler’e bakın', detail: 'Kimin katkı verdiğini gösterir.' },
      ]),
    ]),
    section('tips', [
      tip('Küçük giderleri bile kaydedin. Amacın tamamı, hayvanın ayda gerçekte ne kadara mal olduğunu göstermektir.'),
      p('Acil durum hedefini erken koyun. Veteriner faturaları tam da fonun var olma nedenidir.'),
    ]),
    section('mistakes', [
      ul([
        'Çocukları bağışa zorlamak. Gönüllü katkı bir şey öğretir, zorunlu olan yalnızca kırgınlık.',
        'Bağışı onaylamayı unutup çocuğu sayılıp sayılmadığından emin olmayan bir belirsizlikte bırakmak.',
        'Kimsenin kabul etmediği bir aylık bütçe koyup aşımı başarısızlık gibi görmek.',
      ]),
    ]),
  ],
  related: ['wallet', 'approval-center', 'family-management', 'child-transfers'],
};

export default [wallet, childTransfers, weeklyAllowance, savingsGoals, petBox];
