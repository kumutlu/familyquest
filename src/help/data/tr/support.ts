import type { HelpArticle } from '../../types';
import { faq, info, p, section, soon, steps, tip, ul } from './_shared';

export const faqArticle: HelpArticle = {
  id: 'faq',
  title: 'Sık sorulan sorular',
  description: 'Yeni ailelerin ilk iki haftada en çok sorduğu soruların kısa yanıtları.',
  category: 'support',
  keywords: ['sss', 'sorular', 'yanıtlar', 'sık sorulan', 'yardım', 'hızlı yanıt'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p('Hızlı yanıt sayfası. Sorunuz bir paragraftan fazlasını gerektiriyorsa yanıt sizi ilgili makaleye yönlendirir.'),
    ]),
    section('why', [
      p('Sorular çoğunlukla tekrar eder. Hepsini tek yerde yanıtlamak beş ayrı makale okumaktan hızlıdır.'),
    ]),
    section('who', [p('Ebeveynler ve çocuklar.')]),
    section('how', [
      faq([
        {
          q: 'Puan ile para arasındaki fark nedir?',
          a: 'Puanlar görevlerden ve olumlu davranışlardan kazanılır ve ödüllere harcanır. Para ise çocuğun cüzdanındaki, ebeveynin eklediği gerçek bakiyedir. İkisi ayrıdır; puanlar kendiliğinden paraya dönüşmez.',
        },
        {
          q: 'Puanlarım neden gelmedi?',
          a: 'Görev büyük olasılıkla ebeveyn onayı gerektiriyor. Bir ebeveyn Onay Merkezi’nde onaylayana kadar “Onay bekleniyor” durumunda kalır.',
        },
        {
          q: 'Çocuk ebeveyne para gönderebilir mi?',
          a: 'Hayır. Transferler aynı ailedeki çocuklar arasındadır. Ancak çocuk bir ebeveynden para isteyebilir.',
        },
        {
          q: 'Para gönderdim, bakiyem neden değişmedi?',
          a: 'Bu bilinçli bir tasarım. Bir ebeveyn transferi onaylayana kadar bakiyeniz aynı kalır.',
        },
        {
          q: 'Uygulamayı iki ebeveyn kullanabilir mi?',
          a: 'Evet. İkinci ebeveyn kaydolur ve aile davet kodunu girer. İki ebeveynin de yetkileri aynıdır.',
        },
        {
          q: 'Başka bir çocuğu nasıl eklerim?',
          a: 'Davet kodunu paylaşarak kaydolmalarını sağlayın ya da Aile sayfasından yönetilen çocuk olarak ekleyin.',
        },
        {
          q: 'Queki harçlığı otomatik öder mi?',
          a: 'Henüz hayır. Bugün ebeveyn parayı elle ekler ve doğru sınıflandırılması için nota “Allowance” yazar.',
        },
        {
          q: "Param gerçekten Queki'de mi duruyor?",
          a: 'Hayır. Queki, ailenizin üzerinde anlaştığı bakiyeleri kaydeder. Banka değildir ve gerçek para hareketi yapmaz.',
        },
        {
          q: 'Uygulama dilini değiştirebilir miyim?',
          a: 'Evet — Ayarlar → Dil. İngilizce ve Türkçe desteklenir; değişiklik bu Yardım Merkezi dahil her yere uygulanır.',
        },
        {
          q: 'Ödül kullanımını nasıl geri alırım?',
          a: 'Kendi başınıza geri alma yoktur. Bir ebeveyn olumlu davranış kaydıyla veya cüzdan düzeltmesiyle telafi edebilir.',
        },
        {
          q: 'Queki çevrimdışı çalışır mı?',
          a: 'Hayır. Her aile üyesinin görünümünü eşit tutmak için bağlantıya ihtiyaç duyar.',
        },
        {
          q: 'İndirilecek bir uygulama var mı?',
          a: "Queki, tarayıcınızın paylaş veya menü düğmesinden ana ekranınıza ekleyebileceğiniz bir web uygulamasıdır.",
        },
      ]),
    ]),
    section('steps', [
      steps([
        { title: 'Önce arayın', detail: 'Yardım Merkezi araması başlıkları, anahtar kelimeleri ve makale metnini kapsar.' },
        { title: '? düğmesini kullanın', detail: 'Her ana sayfa kendi makalesini açar.' },
        { title: 'Hâlâ takıldıysanız', detail: 'Belirli sorunların çözümü için Sorun giderme makalesini okuyun.' },
      ]),
    ]),
    section('tips', [
      tip('İlk hafta Ebeveyn rehberi ile Çocuk rehberini birlikte okuyun. Kafa karışıklığının çoğu iki rolün farklı şeyler beklemesinden çıkar.'),
    ]),
    section('mistakes', [
      ul([
        'Puan ile parayı aynı birim sanmak.',
        'Parayla ilgili herhangi bir şeyin ebeveyn onayı olmadan gerçekleşmesini beklemek.',
      ]),
    ]),
  ],
  related: ['troubleshooting', 'welcome', 'parent-guide', 'child-guide'],
};

export const troubleshooting: HelpArticle = {
  id: 'troubleshooting',
  title: 'Sorun giderme',
  description:
    'Ailelerin gerçekten karşılaştığı sorunların çözümleri: gelmeyen puanlar, takılan transferler, giriş sorunları ve ulaşmayan bildirimler.',
  category: 'support',
  keywords: [
    'sorun giderme',
    'sorun',
    'hata',
    'çalışmıyor',
    'takıldı',
    'eksik',
    'düzeltme',
    'giriş yapamıyorum',
  ],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p("Queki'de bir şey beklendiği gibi çalışmadığında neye bakmanız gerektiğinin belirti belirti listesi."),
    ]),
    section('why', [
      p(
        'Bildirilen sorunların neredeyse tamamı birkaç nedene çıkar: onay bekleyen bir şey, yanlış ailede olan biri ya da bayatlamış bir tarayıcı sekmesi. Önce bunları kontrol etmek çok zaman kazandırır.'
      ),
    ]),
    section('who', [p('Herkes. Bazı çözümler ebeveyn gerektirir ve her biri bunu belirtir.')]),
    section('how', [
      p('Görevi tamamladım ama puan gelmedi:'),
      ul([
        'Görev onay gerektiriyor ve hâlâ bekliyor olabilir — Onay Merkezi’ne bakın.',
        'Görev reddedilmiş olabilir. İnceleyen ebeveyne sorun.',
        'Görev bugüne planlanmamış olabilir, bu yüzden tamamlanamaz.',
      ]),
      p('Transfer bekliyor durumunda takıldı:'),
      ul([
        'Bir ebeveyni bekliyor. Bekleyen transferler kendiliğinden sona ermez.',
        'Kardeşe yapılan istek, ebeveyn onaylayabilmesi için önce kardeşin kabulünü gerektirir.',
        'İkinci bir transfer göndermeyin — ebeveynden karar vermesini isteyin.',
      ]),
      p('Bir aile üyesi aile verisini göremiyor:'),
      ul([
        'Davet kodu olmadan kaydolmuş ve kendi boş ailesinde kalmış olabilir.',
        'Bir ebeveyn o hesabı çıkarıp kişiyi kodla yeniden davet etmelidir.',
      ]),
      p('Anlık bildirimler hiç gelmiyor:'),
      ul([
        'Ayarlar → Bildirimler’de “Tarayıcı ayarlarında engellendi” yazıyor mu bakın.',
        'Tarayıcı veya cihaz ayarlarından site için bildirimleri açın, sonra dönüp yeniden etkinleştirin.',
        'Bazı tarayıcılar anlık bildirimi hiç desteklemez; durum bunu yazar.',
        'Bildirim cihaz bazlıdır — dizüstünde açmak telefon için bir şey değiştirmez.',
      ]),
      p('Bakiyeler veya listeler güncel görünmüyor:'),
      ul([
        'Sayfayı yenileyin. Günlerdir açık duran bir sekme eski oturumu tutabilir.',
        'Bildirim merkezinin durumuna bakın; bağlanıyor durumunda takıldıysa Bağlantıyı yeniden dene’yi kullanın.',
        'Cihazın çevrimiçi olduğunu doğrulayın.',
      ]),
      p('Giriş yapamıyorum:'),
      ul([
        'Tahmin etmek yerine şifre sıfırlama e-postasını kullanın.',
        'İlk kez Google ile giriş yaptıysanız yine Google kullanın — ayrı bir Queki şifresi yoktur.',
        'Kaydolduğunuz e-posta adresini kullandığınızdan emin olun.',
      ]),
      info('Bekleyen bir uygulama güncellemesi olabilir. Uygulamayı kapatıp açmak en yeni sürümü uygular.'),
    ]),
    section('steps', [
      p('Bir şey ters gittiğinde bu listeyi sırayla uygulayın:'),
      steps([
        { title: 'Uygulamayı yenileyin', detail: 'Bayat veriyi her şeyden çok bu çözer.' },
        { title: 'Onay Merkezi’ne bakın', detail: '“Kayıp” puan ve paranın çoğu aslında beklemededir.' },
        { title: 'Aileyi doğrulayın', detail: 'Ayarlar → Aile herkeste aynı aile adını göstermelidir.' },
        { title: 'Tarihi ve planı kontrol edin', detail: 'Görevler yalnızca planlandıkları günlerde görünür.' },
        { title: 'Çıkış yapıp tekrar girin', detail: 'Bu, oturumunuzu temiz şekilde tazeler.' },
        { title: 'Ne yaptığınızı not edin', detail: 'Adımlar ve saat, her sorunun teşhisini kolaylaştırır.' },
      ]),
    ]),
    section('tips', [
      tip('Bir şey bildirmeden önce Ayarlar → Hakkında bölümünden uygulama sürümünü kontrol edin.'),
    ]),
    section('mistakes', [
      ul([
        'Bir görüntüleme sorununu çözmek için hesabı veya aileyi silmek.',
        'Başarısız görünen bir işlemi tekrarlayıp yinelenen istekler oluşturmak.',
        'Reddedilen bir öğeyi hata sanmak. Retler gerekçe belirtmez — ebeveyne sorun.',
      ]),
      soon('Uygulama içinden destekle iletişim ve tanılama gönderme.'),
    ]),
  ],
  related: ['faq', 'account-security', 'notifications', 'approval-center'],
};

export default [faqArticle, troubleshooting];
