export interface FeaturedCard {
  id: string
  name: string
  num: string
  set: string
  image: string
  metadata: string
}

// Verified TCGdex printings, retained as a small metadata catalog rather than bundled scans.
export const FEATURED_CARDS: readonly FeaturedCard[] = [
  {
    "id": "sv03.5-166",
    "name": "Bulbasaur",
    "num": "166 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/166/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-166"
  },
  {
    "id": "sv03.5-168",
    "name": "Charmander",
    "num": "168 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/168/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-168"
  },
  {
    "id": "sv03.5-170",
    "name": "Squirtle",
    "num": "170 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/170/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-170"
  },
  {
    "id": "sv03.5-198",
    "name": "Venusaur ex",
    "num": "198 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/198/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-198"
  },
  {
    "id": "sv03.5-199",
    "name": "Charizard ex",
    "num": "199 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-199"
  },
  {
    "id": "sv03.5-200",
    "name": "Blastoise ex",
    "num": "200 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/200/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-200"
  },
  {
    "id": "sv02-203",
    "name": "Magikarp",
    "num": "203 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/203/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-203"
  },
  {
    "id": "sv02-269",
    "name": "Iono",
    "num": "269 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/269/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-269"
  },
  {
    "id": "sv06-203",
    "name": "Caretaker",
    "num": "203 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/203/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-203"
  },
  {
    "id": "sv06-223",
    "name": "Buddy-Buddy Poffin",
    "num": "223 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/223/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-223"
  },
  {
    "id": "sv06-214",
    "name": "Greninja ex",
    "num": "214 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/214/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-214"
  },
  {
    "id": "sv06-217",
    "name": "Carmine",
    "num": "217 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/217/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-217"
  },
  {
    "id": "sv02-194",
    "name": "Heracross",
    "num": "194 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/194/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-194"
  },
  {
    "id": "sv06-168",
    "name": "Pinsir",
    "num": "168 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/168/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-168"
  },
  {
    "id": "sv03.5-167",
    "name": "Ivysaur",
    "num": "167 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/167/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-167"
  },
  {
    "id": "sv02-195",
    "name": "Tropius",
    "num": "195 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/195/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-195"
  },
  {
    "id": "sv06-169",
    "name": "Sunflora",
    "num": "169 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/169/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-169"
  },
  {
    "id": "sv02-196",
    "name": "Sprigatito",
    "num": "196 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/196/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-196"
  },
  {
    "id": "sv06-170",
    "name": "Dipplin",
    "num": "170 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/170/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-170"
  },
  {
    "id": "sv03.5-169",
    "name": "Charmeleon",
    "num": "169 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/169/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-169"
  },
  {
    "id": "sv02-197",
    "name": "Floragato",
    "num": "197 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/197/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-197"
  },
  {
    "id": "sv06-171",
    "name": "Poltchageist",
    "num": "171 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/171/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-171"
  },
  {
    "id": "sv02-198",
    "name": "Bramblin",
    "num": "198 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/198/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-198"
  },
  {
    "id": "sv06-172",
    "name": "Torkoal",
    "num": "172 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/172/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-172"
  },
  {
    "id": "sv03.5-171",
    "name": "Wartortle",
    "num": "171 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/171/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-171"
  },
  {
    "id": "sv02-199",
    "name": "Fletchinder",
    "num": "199 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/199/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-199"
  },
  {
    "id": "sv06-173",
    "name": "Infernape",
    "num": "173 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/173/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-173"
  },
  {
    "id": "sv03.5-172",
    "name": "Caterpie",
    "num": "172 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/172/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-172"
  },
  {
    "id": "sv02-200",
    "name": "Pyroar",
    "num": "200 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/200/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-200"
  },
  {
    "id": "sv06-174",
    "name": "Froslass",
    "num": "174 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/174/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-174"
  },
  {
    "id": "sv03.5-173",
    "name": "Pikachu",
    "num": "173 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/173/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-173"
  },
  {
    "id": "sv02-201",
    "name": "Fuecoco",
    "num": "201 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/201/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-201"
  },
  {
    "id": "sv06-175",
    "name": "Phione",
    "num": "175 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/175/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-175"
  },
  {
    "id": "sv03.5-174",
    "name": "Nidoking",
    "num": "174 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/174/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-174"
  },
  {
    "id": "sv02-202",
    "name": "Crocalor",
    "num": "202 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/202/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-202"
  },
  {
    "id": "sv06-176",
    "name": "Cramorant",
    "num": "176 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/176/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-176"
  },
  {
    "id": "sv03.5-175",
    "name": "Psyduck",
    "num": "175 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/175/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-175"
  },
  {
    "id": "sv06-177",
    "name": "Heliolisk",
    "num": "177 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/177/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-177"
  },
  {
    "id": "sv03.5-176",
    "name": "Poliwhirl",
    "num": "176 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/176/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-176"
  },
  {
    "id": "sv02-204",
    "name": "Marill",
    "num": "204 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/204/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-204"
  },
  {
    "id": "sv06-178",
    "name": "Wattrel",
    "num": "178 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/178/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-178"
  },
  {
    "id": "sv03.5-177",
    "name": "Machoke",
    "num": "177 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/177/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-177"
  },
  {
    "id": "sv02-205",
    "name": "Eiscue",
    "num": "205 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/205/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-205"
  },
  {
    "id": "sv06-179",
    "name": "Chimecho",
    "num": "179 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/179/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-179"
  },
  {
    "id": "sv03.5-178",
    "name": "Tangela",
    "num": "178 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/178/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-178"
  },
  {
    "id": "sv02-206",
    "name": "Quaxly",
    "num": "206 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/206/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-206"
  },
  {
    "id": "sv06-180",
    "name": "Enamorus",
    "num": "180 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/180/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-180"
  },
  {
    "id": "sv03.5-179",
    "name": "Mr. Mime",
    "num": "179 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/179/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-179"
  },
  {
    "id": "sv02-207",
    "name": "Quaxwell",
    "num": "207 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/207/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-207"
  },
  {
    "id": "sv06-181",
    "name": "Hisuian Growlithe",
    "num": "181 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/181/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-181"
  },
  {
    "id": "sv03.5-180",
    "name": "Omanyte",
    "num": "180 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/180/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-180"
  },
  {
    "id": "sv02-208",
    "name": "Frigibax",
    "num": "208 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/208/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-208"
  },
  {
    "id": "sv06-182",
    "name": "Probopass",
    "num": "182 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/182/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-182"
  },
  {
    "id": "sv03.5-181",
    "name": "Dragonair",
    "num": "181 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/181/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-181"
  },
  {
    "id": "sv02-209",
    "name": "Arctibax",
    "num": "209 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/209/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-209"
  },
  {
    "id": "sv06-183",
    "name": "Timburr",
    "num": "183 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/183/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-183"
  },
  {
    "id": "sv03.5-182",
    "name": "Venusaur ex",
    "num": "182 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/182/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-182"
  },
  {
    "id": "sv02-210",
    "name": "Baxcalibur",
    "num": "210 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/210/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-210"
  },
  {
    "id": "sv06-184",
    "name": "Lairon",
    "num": "184 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/184/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-184"
  },
  {
    "id": "sv03.5-183",
    "name": "Charizard ex",
    "num": "183 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/183/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-183"
  },
  {
    "id": "sv02-211",
    "name": "Raichu",
    "num": "211 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/211/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-211"
  },
  {
    "id": "sv06-185",
    "name": "Applin",
    "num": "185 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/185/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-185"
  },
  {
    "id": "sv03.5-184",
    "name": "Blastoise ex",
    "num": "184 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/184/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-184"
  },
  {
    "id": "sv02-212",
    "name": "Mismagius",
    "num": "212 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/212/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-212"
  },
  {
    "id": "sv06-186",
    "name": "Tatsugiri",
    "num": "186 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/186/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-186"
  },
  {
    "id": "sv03.5-185",
    "name": "Arbok ex",
    "num": "185 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/185/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-185"
  },
  {
    "id": "sv02-213",
    "name": "Gothorita",
    "num": "213 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/213/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-213"
  },
  {
    "id": "sv06-187",
    "name": "Chansey",
    "num": "187 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/187/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-187"
  },
  {
    "id": "sv03.5-186",
    "name": "Ninetales ex",
    "num": "186 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/186/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-186"
  },
  {
    "id": "sv02-214",
    "name": "Sandygast",
    "num": "214 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/214/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-214"
  },
  {
    "id": "sv06-188",
    "name": "Eevee",
    "num": "188 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/188/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-188"
  },
  {
    "id": "sv03.5-187",
    "name": "Wigglytuff ex",
    "num": "187 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/187/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-187"
  },
  {
    "id": "sv02-215",
    "name": "Rabsca",
    "num": "215 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/215/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-215"
  },
  {
    "id": "sv06-189",
    "name": "Sinistcha ex",
    "num": "189 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/189/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-189"
  },
  {
    "id": "sv03.5-188",
    "name": "Alakazam ex",
    "num": "188 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/188/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-188"
  },
  {
    "id": "sv02-216",
    "name": "Tinkatink",
    "num": "216 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/216/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-216"
  },
  {
    "id": "sv06-190",
    "name": "Teal Mask Ogerpon ex",
    "num": "190 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/190/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-190"
  },
  {
    "id": "sv03.5-189",
    "name": "Golem ex",
    "num": "189 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/189/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-189"
  },
  {
    "id": "sv02-217",
    "name": "Tinkatuff",
    "num": "217 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/217/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-217"
  },
  {
    "id": "sv06-191",
    "name": "Magcargo ex",
    "num": "191 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/191/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-191"
  },
  {
    "id": "sv03.5-190",
    "name": "Kangaskhan ex",
    "num": "190 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/190/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-190"
  },
  {
    "id": "sv02-218",
    "name": "Paldean Tauros",
    "num": "218 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/218/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-218"
  },
  {
    "id": "sv06-192",
    "name": "Hearthflame Mask Ogerpon ex",
    "num": "192 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/192/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-192"
  },
  {
    "id": "sv03.5-191",
    "name": "Jynx ex",
    "num": "191 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/191/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-191"
  },
  {
    "id": "sv02-219",
    "name": "Sudowoodo",
    "num": "219 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/219/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-219"
  },
  {
    "id": "sv06-193",
    "name": "Palafin ex",
    "num": "193 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/193/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-193"
  },
  {
    "id": "sv03.5-192",
    "name": "Zapdos ex",
    "num": "192 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/192/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-192"
  },
  {
    "id": "sv02-220",
    "name": "Nacli",
    "num": "220 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/220/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-220"
  },
  {
    "id": "sv06-194",
    "name": "Wellspring Mask Ogerpon ex",
    "num": "194 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/194/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-194"
  },
  {
    "id": "sv03.5-193",
    "name": "Mew ex",
    "num": "193 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/193/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-193"
  },
  {
    "id": "sv02-221",
    "name": "Paldean Wooper",
    "num": "221 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/221/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-221"
  },
  {
    "id": "sv06-195",
    "name": "Luxray ex",
    "num": "195 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/195/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-195"
  },
  {
    "id": "sv03.5-194",
    "name": "Bill's Transfer",
    "num": "194 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/194/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-194"
  },
  {
    "id": "sv02-222",
    "name": "Tyranitar",
    "num": "222 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/222/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-222"
  },
  {
    "id": "sv06-196",
    "name": "Iron Thorns ex",
    "num": "196 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/196/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-196"
  },
  {
    "id": "sv03.5-195",
    "name": "Daisy's Help",
    "num": "195 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/195/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-195"
  },
  {
    "id": "sv02-223",
    "name": "Grafaiai",
    "num": "223 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/223/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-223"
  },
  {
    "id": "sv06-197",
    "name": "Scream Tail ex",
    "num": "197 / 167",
    "set": "Twilight Masquerade",
    "image": "https://assets.tcgdex.net/en/sv/sv06/197/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv06-197"
  },
  {
    "id": "sv03.5-196",
    "name": "Erika's Invitation",
    "num": "196 / 165",
    "set": "151",
    "image": "https://assets.tcgdex.net/en/sv/sv03.5/196/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv03.5-196"
  },
  {
    "id": "sv02-224",
    "name": "Orthworm",
    "num": "224 / 193",
    "set": "Paldea Evolved",
    "image": "https://assets.tcgdex.net/en/sv/sv02/224/high.webp",
    "metadata": "https://api.tcgdex.net/v2/en/cards/sv02-224"
  }
]

export function getFeaturedCardImageUrl(card: FeaturedCard, width?: number): string {
  const url = `/api/card-image-proxy?url=${encodeURIComponent(card.image)}`
  return width ? `${url}&w=${width}` : url
}

/** Proxy widths offered to the browser; the original scan (600px wide) covers anything larger. */
const FEATURED_CARD_SRCSET_WIDTHS = [160, 240, 320, 480] as const

/** `srcset` for a featured card so phones download a scan sized to the slot rather than the full image. */
export function getFeaturedCardImageSrcSet(card: FeaturedCard): string {
  return [
    ...FEATURED_CARD_SRCSET_WIDTHS.map((width) => `${getFeaturedCardImageUrl(card, width)} ${width}w`),
    `${getFeaturedCardImageUrl(card)} 600w`,
  ].join(", ")
}
