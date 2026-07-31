import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul } from './_shared';

export const welcome: HelpArticle = {
  id: 'welcome',
  title: "Queki'ye hoş geldiniz",
  description:
    'Queki ne yapar? Görevler, puanlar, ödüller, cüzdanlar ve ailenin ortak görünümü — tek sayfalık tur.',
  category: 'basics',
  keywords: ['hoş geldiniz', 'tanıtım', 'genel bakış', 'queki nedir', 'başlangıç', 'tur'],
  readingTimeMinutes: 3,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  gettingStartedOrder: 1,
  sections: [
    section('what', [
      p(
        'Queki tek bir aile için ortak bir uygulamadır. Ebeveynler görevleri, davranışları, ödülleri ve parayı ayarlar; çocuklar görevleri tamamlar, puan kazanır ve kazandıklarını harcar veya biriktirir. Herkes aynı aileye giriş yapar ve kendisini ilgilendiren bölümleri görür.'
      ),
      ul([
        'Görevler — puan kazandıran ev işleri ve rutinler.',
        'Davranışlar — ebeveynin kaydettiği tek seferlik olumlu ya da olumsuz olaylar.',
        'Ödüller — çocukların kazandıkları puanlarla aldığı katalog.',
        'Cüzdanlar — her çocuk için ebeveynlerin yönettiği gerçek para bakiyesi.',
        'Birikim hedefleri, Pet Box ve Aile Panosu — aile düzeyinde ortak özellikler.',
      ]),
    ]),
    section('why', [
      p(
        'Harçlık konuşmaları genelde dağınık ilerler: bir hatırlatma, bir söz, çekmecede biraz nakit. Queki anlaşmayı tek yerde toplar; böylece emek ile karşılık herkese görünür olur ve hiçbir şey hafızaya kalmaz.'
      ),
    ]),
    section('who', [
      p(
        'Ailedeki herkes. Ebeveynler kurulum ve onay araçlarını, çocuklar kendi görev, puan, cüzdan ve hedef görünümünü kullanır. İki rol de aynı dört sekmeyi görür: Ana sayfa, Görevler, Ödüller ve Aile.'
      ),
    ]),
    section('how', [
      p(
        'Bir yetişkin aileyi oluşturur ve bir davet kodu alır. Diğer ebeveynler ve çocuklar bu kodla katılır. Bundan sonra her şey aileye aittir: görevler, ödüller, bakiyeler ve geçmiş paylaşılır; puanı veya parayı hareket ettiren her şeyi ebeveynler onaylar.'
      ),
      info(
        'Queki, ana ekrana eklenebilen bir web uygulamasıdır. Ayrı bir indirme yönetmeniz gerekmez ve tüm cihazlar aynı canlı veriyi gösterir.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Ailenizi oluşturun', detail: 'Ebeveyn olarak kaydolun ve aileye bir ad verin.' },
        { title: 'Herkesi davet edin', detail: 'Ayarlar → Aile bölümündeki davet kodunu paylaşın.' },
        { title: 'Birkaç görev ekleyin', detail: 'İlk hafta için üç dört görev fazlasıyla yeterli.' },
        { title: 'İki ödül ekleyin', detail: 'Biri ucuz, biri hayal edilesi olsun.' },
        { title: 'Bir hafta deneyin', detail: 'Tamamlananları onaylayın ve neyin tuttuğunu görün.' },
      ]),
    ]),
    section('tips', [
      tip('Gereğinden küçük başlayın. İlk gün 20 görev ekleyen aileler dördüncü günde bırakıyor.'),
      p('Ödülleri eklemeden önce puan-para oranını yüksek sesle konuşun. Sonraki tartışmaları önler.'),
    ]),
    section('mistakes', [
      ul([
        'Davet koduyla katılmak yerine ikinci kez kaydolarak ikinci bir aile oluşturmak.',
        'Her görevi “Ebeveyn onayı gerekir” yapmak; uygulama sizin için bir iş kuyruğuna dönüşür.',
        'Kimsenin istemediği ödüller ekleyip puanların neden harcanmadığını merak etmek.',
      ]),
      soon('Sizin için başlangıç görev ve ödül seti oluşturan rehberli kurulum sihirbazı.'),
    ]),
  ],
  related: ['getting-started', 'parent-guide', 'child-guide', 'dashboard'],
};

export const gettingStarted: HelpArticle = {
  id: 'getting-started',
  title: 'Başlarken',
  description:
    'Ailenizi oluşturun, ebeveynleri ve çocukları davet edin ve ilk haftayı kafa karışıklığı olmadan geçirin.',
  category: 'basics',
  keywords: [
    'kurulum',
    'kayıt',
    'davet kodu',
    'aileye katıl',
    'ilk hafta',
    'aile oluştur',
    'başlangıç',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  popular: true,
  gettingStartedOrder: 2,
  sections: [
    section('what', [
      p(
        'Boş bir hesaptan çalışan bir aileye giden kurulum yolu: bir ebeveyn kaydolur, aileyi adlandırır ve tek bir kodla herkesi davet eder.'
      ),
    ]),
    section('why', [
      p(
        "Queki'deki her şey aile kaydına bağlıdır — görevler, cüzdanlar, onaylar ve geçmiş. Üyeler farklı ailelerde kalırsa birbirlerinin verisini göremez; bu yüzden bu adım diğerlerinden daha önemlidir."
      ),
    ]),
    section('who', [
      p(
        'İlk kaydolan ebeveyn aileyi oluşturur ve sahibi olur. Başka bir yetişkin ebeveyn olarak katılabilir. Çocuklar ya kendi girişleriyle katılır ya da bir ebeveyn tarafından oluşturulup yönetilir.'
      ),
    ]),
    section('how', [
      p(
        'Kayıt hesabınızı oluşturur, ardından tanıtım akışı aileyi kurar ve sizi içine alır. Ayarlar → Aile davet kodunu gösterir; kaydolurken bu kodu giren herkes yeni bir aile açmak yerine sizin ailenize katılır.'
      ),
      info(
        'Bir kişi yalnızca tek bir aileye ait olabilir. Kodsuz kaydolan biri, çıkarılıp yeniden davet edilmelidir — “başka aileye taşı” diye bir işlem yoktur.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Kaydolun', detail: 'Kayıt ekranında e-posta/şifre veya Google girişini kullanın.' },
        {
          title: 'Tanıtım akışını tamamlayın',
          detail: 'Aileye bir ad verin ve ailenizin kullandığı para birimini seçin.',
        },
        { title: 'Davet kodunu kopyalayın', detail: 'Ayarlar → Aile → Davet kodunda kopyalama düğmesi var.' },
        {
          title: 'İkinci ebeveyni davet edin',
          detail: 'Kaydolurken kodu girsinler ki sizin ailenize düşsünler.',
        },
        {
          title: 'Çocuklarınızı ekleyin',
          detail: 'Aile sayfasından ekleyin ya da davet koduyla kaydolsunlar.',
        },
        {
          title: 'Üç görev ve iki ödül oluşturun',
          detail: 'Hızlı ilerlemek için formlardaki şablonları kullanın.',
        },
        {
          title: 'Döngüyü çocuklarınıza anlatın',
          detail: 'Görevi yap → tamamlandı işaretle → ebeveyn onaylar → puan gelir → ödüle harca.',
        },
      ]),
    ]),
    section('tips', [
      tip('İlk haftayı her şey onaylı çalıştırın, sonra güvendiğiniz görevlerde onayı kaldırın.'),
      p('Aile para birimini tanıtım sırasında ayarlayın. Uygulamadaki tüm tutarlar bu birimde gösterilir.'),
    ]),
    section('mistakes', [
      ul([
        'İkinci ebeveynin davet kodu olmadan kaydolması — boş bir ailede tek başına kalır.',
        'Tamamlanan görevlerin puan gelmeden önce onay gerektirdiğini çocuklara söylememek.',
        'Bir çocuğun haftada gerçekçi olarak kaç puan kazanabileceğini bilmeden ödül fiyatlamak.',
      ]),
      info(
        'Davet kodunu yenileme henüz mevcut değil; bu yüzden kodu kalıcı gibi düşünün ve yalnızca özel olarak paylaşın.'
      ),
    ]),
  ],
  related: ['welcome', 'parent-guide', 'family-management', 'tasks'],
};

export default [welcome, gettingStarted];
