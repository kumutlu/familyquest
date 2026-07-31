import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul } from './_shared';

export const parentGuide: HelpArticle = {
  id: 'parent-guide',
  title: 'Ebeveyn rehberi',
  description:
    'Bir ebeveynin yapabileceği her şey: görev ve ödül oluşturmak, davranış kaydetmek, istekleri onaylamak ve cüzdanları yönetmek.',
  category: 'roles',
  keywords: ['ebeveyn', 'yetişkin', 'yönetici', 'yetki', 'onayla', 'yönet', 'aile sahibi'],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  popular: true,
  gettingStartedOrder: 3,
  sections: [
    section('what', [
      p(
        "Ebeveyn rolü Queki'nin yönetim tarafıdır. Ebeveynler neyin puan kazandıracağını, puanların ne satın alacağını ve gerçek paranın nasıl hareket edeceğini belirler. Bakiyeyi değiştiren hiçbir şey ebeveyn olmadan gerçekleşmez."
      ),
    ]),
    section('why', [
      p(
        'Çocukların güvenli sınırlar içinde özerkliğe ihtiyacı var. Oluşturma ve onaylama yetkisinin ebeveynde olması, çocuğun rahatça hareket etmesini — istemesini, tamamlamasını, harcamasını — sağlarken ailenin son sözü elinde tutmasına imkân verir.'
      ),
    ]),
    section('who', [
      p(
        'Ailedeki her yetişkin. Aileyi kuran ebeveyn ayrıca sahibidir; bu yalnızca hesap silinirken önemlidir: sahip, önce sahipliği başka bir ebeveyne devretmelidir.'
      ),
    ]),
    section('how', [
      p('Ebeveynlerin çocuklarda olmayan yetkileri:'),
      ul([
        'Görev ve ödül oluşturma, düzenleme ve arşivleme.',
        'Davranış kaydetme — olumlu puan, olumsuz puan veya para cezası.',
        'Herhangi bir çocuk cüzdanına para ekleme ve cüzdandan para çekme.',
        "Onay Merkezi'ndeki her şeyi onaylama veya reddetme.",
        'Aile Panosu’nda duyuru yayımlama.',
        'Evcil hayvan ekleme ve Pet Box gideri kaydetme.',
        'Aile üyesi ekleme ve çıkarma.',
      ]),
      info(
        'Ebeveynler çocuklarla aynı dört sekmeyi görür. Ek araçlar bu sayfaların içinde belirir — örneğin Onay Merkezi ebeveyn panosunda, “Cüzdanı Yönet” ise Çocuk Cüzdanları ekranında yer alır.'
      ),
    ]),
    section('steps', [
      p('Tipik bir ebeveyn haftası:'),
      steps([
        { title: 'Pazartesi: panoya bakın', detail: 'Ana sayfayı açıp her çocuğun ilerlemesine göz atın.' },
        {
          title: 'Her gün: onayları temizleyin',
          detail: 'Onay Merkezi tamamlanan görevleri ve para isteklerini gösterir.',
        },
        {
          title: 'Anında: davranışları kaydedin',
          detail: 'Sıra dışı yardımı ya da gerçekten kabul edilemez olanı sıcağı sıcağına yazın.',
        },
        { title: 'Ödeme günü: cüzdanları doldurun', detail: 'Aile → çocuk → Cüzdanı Yönet → Para Ekle.' },
        {
          title: 'Pazar: ayar yapın',
          detail: 'Kimsenin yapmadığı görevleri arşivleyin; kimsenin alamadığı ödülleri yeniden fiyatlayın.',
        },
      ]),
    ]),
    section('tips', [
      tip('Onayları gün boyu değil tek oturumda yapın. Çocuklar ritmi öğrenir ve sormayı bırakır.'),
      p('Silmek yerine arşivleyin. Arşivleme geçmişi korur, böylece eski puanlar anlamlı kalır.'),
      p('İki ebeveyn ceza büyüklüklerinde önceden anlaşmalı; çocukların fark ettiği şey tutarsızlıktır.'),
    ]),
    section('mistakes', [
      ul([
        'Onayları günlerce bekletmek — çocuklar emeğin karşılık bulduğuna inanmayı bırakır.',
        'Küçük şeyler için para cezası kullanmak; cüzdan bir ceza aracına dönüşür.',
        'Bir görevin puan değerini hafta ortasında kimseye söylemeden değiştirmek.',
      ]),
      soon('Ebeveyn başına yetki seviyeleri. Bugün her ebeveynin yetkisi aynıdır.'),
    ]),
  ],
  related: ['approval-center', 'tasks', 'behaviours', 'wallet'],
};

export const childGuide: HelpArticle = {
  id: 'child-guide',
  title: 'Çocuk rehberi',
  description:
    'Nasıl puan kazanırsın, ödüle nasıl harcarsın, cüzdanını nasıl kullanırsın ve ebeveyninden nasıl para istersin.',
  category: 'roles',
  keywords: ['çocuk', 'puan', 'kazan', 'harca', 'cüzdanım', 'seviye', 'seri', 'ödül'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['child'],
  popular: true,
  gettingStartedOrder: 4,
  sections: [
    section('what', [
      p(
        "Queki'nin sana ait tarafı: yapılacak görev listesi, yaptıkça toplanan puanlar, bu puanlarla alabileceğin ödüller ve içinde gerçek paranın olduğu bir cüzdan."
      ),
    ]),
    section('why', [
      p(
        'Anlaşmayı netleştirir. Bir işin ne kadar değdiğini daha yapmadan görürsün ve bakiyeni kimseye sormadan kontrol edebilirsin.'
      ),
    ]),
    section('who', [
      p(
        'Ailedeki her çocuğun kendi hesabı, kendi puanı, cüzdanı ve hedefleri vardır. Bazı görevler sana atanır; bazıları ortaktır ve isteyen alabilir.'
      ),
    ]),
    section('how', [
      p(
        'Görevi tamamlandı olarak işaretlersin. Onay gerekiyorsa bir ebeveyn onaylayana kadar “Onay bekleniyor” yazar — onaylandığında puanlar gelir. Puanlar ödül alır. Cüzdanındaki para puanlardan ayrıdır ve parayı hareket ettirmek her zaman ebeveyn onayı gerektirir.'
      ),
      info('Puanlar ödüller içindir. Cüzdanındaki para ise ebeveynlerinin eklediği gerçek paradır.'),
    ]),
    section('steps', [
      steps([
        { title: 'Görevler’i aç', detail: 'Bugün ne olduğunu görmek için filtreleri kullan.' },
        { title: 'İşi yap, sonra göreve dokun', detail: '“Tamamlandı olarak işaretle”yi seç.' },
        { title: 'Yazıyorsa bekle', detail: '“Onay bekleniyor”, bir ebeveynin onaylaması gerektiği anlamına gelir.' },
        { title: 'Puanlarını Ana sayfada gör', detail: 'Seviyen ve serin ilerledikçe güncellenir.' },
        { title: 'Ödüller’de harca', detail: 'Ödüller’i aç, gücünün yettiğini seç ve Kullan’a dokun.' },
        {
          title: 'Para mı lazım?',
          detail: 'Cüzdanını aç ve Para İste ile bir ebeveynden veya kardeşinden iste.',
        },
      ]),
    ]),
    section('tips', [
      tip('Günlük görevlerin puanı düşüktür ama tek seferlik büyük işlerden daha hızlı birikir.'),
      p('Büyük bir şey için biriktiriyorsan bir birikim hedefi oluştur; para ayrılır ve harcaması zorlaşır.'),
    ]),
    section('mistakes', [
      ul([
        'Görevi gerçekten bitirmeden tamamlandı işaretlemek — ebeveyn reddedebilir.',
        'Transferin anında gitmesini beklemek. Gönderdiğin para, onaylanana kadar bakiyende kalır.',
        'Yanlışlıkla ödül kullanmak. Bir ebeveynden yardım iste; kendi başına geri alma yok.',
      ]),
    ]),
  ],
  related: ['tasks', 'rewards', 'wallet', 'savings-goals'],
};

export default [parentGuide, childGuide];
