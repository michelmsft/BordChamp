param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [string]$Output = (Join-Path $PSScriptRoot "..\public\commodities"),
  [string]$CatalogOutput = (Join-Path $PSScriptRoot "..\src\product-image-catalog.ts")
)

Add-Type -AssemblyName System.Drawing

$sections = @(
  @{ Prefix = "crop"; Label = "Cultures"; Columns = 10; ColumnBoundaries = @(16, 88, 159, 231, 302, 373, 444, 509, 576, 645, 715); RowBoundaries = @(17, 83, 141, 197, 255, 316, 369, 431, 490, 547, 599); Labels = @(
    "Fonio", "Riz paddy", "Riz blanc", "Riz étuvé", "Maïs", "Sorgho", "Mil", "Blé", "Avoine", "Orge",
    "Niébé", "Haricot rouge", "Haricot blanc", "Haricot vert", "Pois de terre (voandzou)", "Arachide", "Soja", "Pois", "Lentille", "Fève",
    "Manioc", "Igname", "Patate douce", "Pomme de terre", "Taro", "Macabo", "Gombo", "Épinard", "Oseille", "Feuille de manioc",
    "Feuille de patate douce", "Feuille de taro", "Feuille de corète", "Laitue", "Chou", "Chou-fleur", "Carotte", "Courgette", "Navet", "Betterave",
    "Tomate", "Oignon", "Ail", "Échalote", "Piment", "Poivron", "Aubergine", "Concombre", "Persil", "Céleri",
      "Poireau", "Citronnelle", "Basilic", "Menthe", "Gingembre", "Curcuma", "Roucou (épice)", "Poivre noir", "Poivre blanc", "Vanille",
    "Banane plantain", "Banane douce", "Ananas", "Mangue", "Papaye", "Orange", "Citron", "Citron vert", "Mandarine", "Pamplemousse",
    "Avocat", "Goyave", "Grenadille", "Pastèque", "Melon", "Corossol", "Grenade", "Fruit tropical brun", "Noix tropicales", "Ditakh",
    "Coton", "Noix de cajou (anacarde)", "Noix de kola", "Karité", "Graines de courge (pistache africaine)", "Palmiste", "Coprah", "Fibre de coton", "Noix de palme", "Cacao",
    "Bissap", "Néré", "Baobab (pain de singe)", "Champignon frais", "Plantes maraîchères", "Plants fruitiers", "Pépinières forestières", "Fleurs coupées", "Roucou (fruit)", "Autres plantes aromatiques"
  )},
  @{ Prefix = "aquaculture"; Label = "Aquaculture / pêche"; Columns = 5; ColumnBoundaries = @(736, 817, 902, 991, 1073, 1159); RowBoundaries = @(17, 83, 150, 216, 281, 354, 429, 506, 583); Labels = @(
    "Tilapia", "Silure", "Carpe", "Heterotis", "Mâchoiron", "Ethmalose", "Mulet", "Capitaine", "Thon", "Bonite",
    "Sardine", "Sardinelle", "Maquereau", "Chinchard", "Barracuda", "Mérou", "Dorade", "Sole", "Carangue", "Langouste",
    "Crevette", "Crevette géante", "Crabe", "Homard", "Écrevisse", "Coquillages", "Moules", "Huître", "Coquille Saint-Jacques", "Poulpe",
    "Grenouille", "Oursins", "Concombres de mer", "Poissons séchés", "Fretin séché", "Fretin argenté", "Anguille", "Petits poissons séchés", "Alevins", "Œufs de poisson"
  )},
  @{ Prefix = "live-animal"; Label = "Animaux vivants"; Columns = 4; ColumnBoundaries = @(1175, 1263, 1352, 1435, 1521); RowBoundaries = @(17, 86, 152, 216, 286, 359, 429, 502, 583); Labels = @(
    "Bovin", "Vache laitière", "Ovin (mouton)", "Génisse",
    "Veau", "Bélier", "Brebis", "Caprin (chèvre)",
    "Porc", "Truie", "Verrat", "Porcelet",
    "Lapin", "Poule pondeuse", "Coq reproducteur", "Canard",
    "Oie", "Cane", "Pintade", "Dindon",
    "Poulet de chair", "Pintadeau", "Caille", "Cailleteau",
    "Poussin chair", "Poussin pondeuse", "Poussin d'un jour", "Caneton",
    "Escargot vivant", "Escargot géant", "Essaim d'abeilles", "Ruche d'abeilles"
  )},
  @{ Prefix = "animal-product"; Label = "Produits animaux"; Columns = 7; ColumnBoundaries = @(15, 86, 155, 229, 301, 373, 443, 522); RowBoundaries = @(621, 689, 754, 818, 882, 946, 1011); Labels = @(
    "Œufs de poule", "Œufs de pintade", "Œufs de dinde", "Œufs de cane", "Œufs de caille", "Œufs de caille blancs", "Œufs à couver",
    "Lait de vache", "Lait de chèvre", "Yaourt", "Beurre", "Crème fraîche", "Fromage", "Miel",
    "Viande de bœuf", "Viande de veau", "Côtes de porc", "Côtelettes de mouton", "Viande de porc", "Viande hachée", "Abats bovins",
    "Poulet entier", "Viande de mouton", "Poisson fumé", "Poisson séché", "Viande de porc en tranche", "Viande de volaille", "Poulet prêt à cuire",
    "Viande de chèvre", "Abats de volaille", "Viande de lapin", "Poisson frais", "Crevettes", "Crevettes séchées", "Chair d'escargot",
    "Viande en morceaux", "Abats", "Escargots décortiqués", "Escargots bruns", "Escargots géants", "Escargots transformés", "Produit d'escargot préparé"
  )},
  @{ Prefix = "byproduct"; Label = "Sous-produits & intrants"; Columns = 6; ColumnBoundaries = @(538, 626, 713, 803, 891, 975, 1062); RowBoundaries = @(622, 689, 754, 816, 883, 948, 1010); Labels = @(
    "Fumier bovin", "Fumier ovin", "Fumier caprin", "Fientes de volaille", "Compost", "Lisier",
    "Paille", "Son", "Tourteau d'arachide", "Tourteau de coton", "Tourteau de soja", "Tourteau de palmiste",
    "Coques de cacao", "Pulpe de cacao", "Gousses de vanille", "Graines de coton", "Pailles de riz", "Balles de riz",
    "Coques de cajou", "Pulpe de café", "Drêches de café", "Graines de néré", "Coques de palmiste", "Fibres de coco",
      "Bois de chauffe", "Charbon de bois", "Os", "Graisse animale", "Écorces broyées", "Sciures",
      "Résidus agricoles", "Paille hachée", "Fourrage vert", "Aliment protéiné", "Maïs grain", "Aliment composé"
  )},
  @{ Prefix = "processed"; Label = "Transformation & dérivés"; Columns = 6; ColumnBoundaries = @(1079, 1152, 1229, 1303, 1375, 1448, 1522); RowBoundaries = @(622, 689, 754, 824, 888, 956, 1010); Labels = @(
    "Farine de manioc", "Attiéké", "Placali", "Gari", "Foufou", "Foufou préparé",
    "Huile de palme", "Huile de palmiste", "Huile d'arachide", "Huile de coton", "Huile de coco", "Huile raffinée",
    "Beurre de karité", "Noix de karité", "Poudre de baobab", "Confiture", "Jus de fruits", "Fruits séchés",
    "Café vert", "Café torréfié", "Cacao en poudre", "Pâte de cacao", "Chocolat", "Bissap séché (fleurs)",
    "Riz étuvé", "Riz parfumé", "Sucre", "Vin de palme", "Sirop", "Bissap séché (calices)",
      "Graines brunes", "Graines blondes", "Graines dorées", "Graines claires", "Maïs concassé", "Graines foncées"
  )}
)

$sourceImage = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
try {
  if ($sourceImage.Width -ne 1536 -or $sourceImage.Height -ne 1024) {
    throw "Expected a 1536x1024 product atlas, received $($sourceImage.Width)x$($sourceImage.Height)."
  }

  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  Get-ChildItem $Output -Filter "*.png" -File | Remove-Item

  $manifest = @()
  foreach ($section in $sections) {
    $rows = $section.RowBoundaries.Count - 1
    for ($row = 0; $row -lt $rows; $row++) {
      for ($column = 0; $column -lt $section.Columns; $column++) {
        $index = ($row * $section.Columns) + $column + 1
        $label = if ($index -le $section.Labels.Count -and -not [string]::IsNullOrWhiteSpace($section.Labels[$index - 1])) {
          $section.Labels[$index - 1]
        } else {
          "$($section.Label) $index"
        }
        $name = "{0}-{1:d2}" -f $section.Prefix, $index
        $left = $section.ColumnBoundaries[$column] + 3
        $top = $section.RowBoundaries[$row] + 3
        $right = $section.ColumnBoundaries[$column + 1] - 3
        $bottom = $section.RowBoundaries[$row + 1] - 3
        $sourceRectangle = [System.Drawing.Rectangle]::FromLTRB($left, $top, $right, $bottom)

        $thumbnail = [System.Drawing.Bitmap]::new(160, 160)
        try {
          $graphics = [System.Drawing.Graphics]::FromImage($thumbnail)
          try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $scale = [Math]::Min(150 / $sourceRectangle.Width, 150 / $sourceRectangle.Height)
            $destinationWidth = [Math]::Round($sourceRectangle.Width * $scale)
            $destinationHeight = [Math]::Round($sourceRectangle.Height * $scale)
            $destination = [System.Drawing.Rectangle]::new(
              [Math]::Round((160 - $destinationWidth) / 2),
              [Math]::Round((160 - $destinationHeight) / 2),
              $destinationWidth,
              $destinationHeight
            )
            $graphics.DrawImage(
              $sourceImage,
              $destination,
              $sourceRectangle,
              [System.Drawing.GraphicsUnit]::Pixel
            )
          } finally {
            $graphics.Dispose()
          }
          $thumbnail.Save((Join-Path $Output "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
          $thumbnail.Dispose()
        }

        $manifest += [ordered]@{
          name = $name
          category = $section.Prefix
          label = $label
          path = "/commodities/$name.png"
        }
      }
    }
  }

  $manifest | ConvertTo-Json | Set-Content (Join-Path $Output "manifest.json") -Encoding utf8
  $catalogLines = @(
    "// Generated by scripts/extract-product-images.ps1. Do not edit manually.",
    "export const PRODUCT_IMAGE_CATALOG = ["
  )
  foreach ($section in $sections) {
    $items = $manifest | Where-Object { $_.category -eq $section.Prefix }
    $catalogLines += "  { id: '$($section.Prefix)', label: '$($section.Label.Replace("'", "\'"))', images: ["
    foreach ($item in $items) {
      $escapedLabel = $item.label.Replace("'", "\'")
      $catalogLines += "    { name: '$($item.name)', label: '$escapedLabel' },"
    }
    $catalogLines += "  ] },"
  }
  $catalogLines += "] as const"
  $catalogLines | Set-Content $CatalogOutput -Encoding utf8
  Write-Output "Extracted $($manifest.Count) product images to $Output."
} finally {
  $sourceImage.Dispose()
}