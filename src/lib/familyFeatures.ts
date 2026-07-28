export function isPetBoxEnabled(familyData: any | null | undefined): boolean {
  return familyData?.petBoxEnabled !== false;
}
