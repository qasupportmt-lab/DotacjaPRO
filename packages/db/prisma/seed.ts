import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const institutions = [
  {
    code: 'WUP_KATOWICE_DIRECTORY',
    type: 'REGIONAL_LABOUR_OFFICE',
    name: 'Wojewódzki Urząd Pracy w Katowicach — wykaz PUP',
    officialUrl: 'https://wupkatowice.praca.gov.pl/',
    source: 'https://wupkatowice.praca.gov.pl/-/840189-powiatowe-urzedy-pracy',
    kind: 'PUP_DIRECTORY',
    scopeVoivodeship: 'śląskie'
  },
  {
    code: 'PUP_KATOWICE_CALL_2026',
    type: 'PUP',
    name: 'Powiatowy Urząd Pracy w Katowicach — nabór działalność 2026',
    officialUrl: 'https://katowice.praca.gov.pl/',
    source: 'https://katowice.praca.gov.pl/rynek-pracy/aktualnosci/-/asset_publisher/8VCc6CLiHUaO/content/nabor-wnioskow-o-dofinansowanie-przyznanie-bezrobotnemu-srodkow-na-podjecie-dzialalnosci-gospodarczej-1?p_r_p_assetEntryId=58924503',
    kind: 'PUP_CALL_PAGE',
    scopeVoivodeship: 'śląskie'
  },
  {
    code: 'PORTAL_FE',
    type: 'FUNDING_PORTAL',
    name: 'Portal Funduszy Europejskich',
    officialUrl: 'https://funduszeeuropejskie.gov.pl/',
    source: 'https://funduszeeuropejskie.gov.pl/wyszukiwarka/',
    kind: 'FUNDING_DISCOVERY'
  },
  {
    code: 'PARP',
    type: 'NATIONAL_AGENCY',
    name: 'Polska Agencja Rozwoju Przedsiębiorczości',
    officialUrl: 'https://www.parp.gov.pl/',
    source: 'https://www.parp.gov.pl/',
    kind: 'FUNDING_DISCOVERY'
  },
  {
    code: 'BGK',
    type: 'NATIONAL_BANK',
    name: 'Bank Gospodarstwa Krajowego',
    officialUrl: 'https://www.bgk.pl/',
    source: 'https://www.bgk.pl/produkty/pozyczka-na-samozatrudnienie/',
    kind: 'FUNDING_PROGRAM'
  },
  {
    code: 'PFRON',
    type: 'NATIONAL_FUND',
    name: 'Państwowy Fundusz Rehabilitacji Osób Niepełnosprawnych',
    officialUrl: 'https://www.pfron.org.pl/',
    source: 'https://www.pfron.org.pl/',
    kind: 'FUNDING_DISCOVERY'
  },
  {
    code: 'ARIMR',
    type: 'NATIONAL_AGENCY',
    name: 'Agencja Restrukturyzacji i Modernizacji Rolnictwa',
    officialUrl: 'https://www.gov.pl/web/arimr',
    source: 'https://www.gov.pl/web/arimr',
    kind: 'FUNDING_DISCOVERY'
  },
  {
    code: 'PSZ',
    type: 'LABOUR_MARKET_PORTAL',
    name: 'Publiczne Służby Zatrudnienia',
    officialUrl: 'https://psz.praca.gov.pl/',
    source: 'https://psz.praca.gov.pl/',
    kind: 'LABOUR_MARKET_DISCOVERY'
  }
] as const;

async function main() {
  for (const item of institutions) {
    const institution = await prisma.institution.upsert({
      where: { code: item.code },
      update: {
        type: item.type,
        name: item.name,
        officialUrl: item.officialUrl
      },
      create: {
        code: item.code,
        type: item.type,
        name: item.name,
        officialUrl: item.officialUrl
      }
    });

    await prisma.source.upsert({
      where: { canonicalUrl: item.source },
      update: {
        institutionId: institution.id,
        kind: item.kind,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: 'scopeVoivodeship' in item ? item.scopeVoivodeship : null
      },
      create: {
        institutionId: institution.id,
        kind: item.kind,
        canonicalUrl: item.source,
        trustLevel: 'OFFICIAL_PRIMARY',
        enabled: true,
        scopeVoivodeship: 'scopeVoivodeship' in item ? item.scopeVoivodeship : null
      }
    });
  }
}

main()
  .finally(async () => prisma.$disconnect());
